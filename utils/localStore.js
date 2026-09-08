const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "..", "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create local data directory:", err);
  }
}

/**
 * MongoDB ObjectId-compatible ID object
 */
class LocalId {
  constructor(id) {
    this._id = id ? id.toString() : crypto.randomBytes(12).toString("hex");
  }

  toString() {
    return this._id;
  }

  toJSON() {
    return this._id;
  }

  equals(other) {
    if (!other) return false;
    const otherStr = typeof other.toString === "function" ? other.toString() : String(other);
    return this._id === otherStr;
  }
}

const toLocalId = (val) => {
  if (val instanceof LocalId) return val;
  return new LocalId(val);
};

const toNullableLocalId = (val) => {
  if (!val) return null;
  if (val instanceof LocalId) return val;
  return new LocalId(val);
};

/**
 * Check if a document matches a MongoDB-style query
 */
const matchesQuery = (doc, query) => {
  if (!query || Object.keys(query).length === 0) return true;

  for (const key of Object.keys(query)) {
    if (key === "$or") {
      const orList = query["$or"];
      const matchesAny = orList.some((subQuery) => matchesQuery(doc, subQuery));
      if (!matchesAny) return false;
      continue;
    }

    const expected = query[key];
    const actual = doc[key];

    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }

    if (typeof expected === "object" && expected !== null && !Array.isArray(expected) && !(expected instanceof LocalId)) {
      if (expected.$in && Array.isArray(expected.$in)) {
        const actualStr = actual ? actual.toString() : actual;
        const matchesIn = expected.$in.some((item) => (item ? item.toString() : item) === actualStr);
        if (!matchesIn) return false;
        continue;
      }
    }

    const expStr = expected && typeof expected.toString === "function" ? expected.toString() : String(expected);
    const actStr = actual && typeof actual.toString === "function" ? actual.toString() : String(actual);

    if (expStr !== actStr) {
      return false;
    }
  }

  return true;
};

/**
 * Thenable & chainable Query builder mimicking Mongoose Query
 */
class LocalQuery {
  constructor(items, docEnhancer = (d) => d) {
    this.items = [...items];
    this.docEnhancer = docEnhancer;
  }

  sort(sortObj) {
    if (sortObj && typeof sortObj === "object") {
      const field = Object.keys(sortObj)[0];
      const dir = sortObj[field] >= 0 ? 1 : -1;
      this.items.sort((a, b) => {
        const aVal = a[field] ? new Date(a[field]).getTime() || a[field] : 0;
        const bVal = b[field] ? new Date(b[field]).getTime() || b[field] : 0;
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
        return 0;
      });
    }
    return this;
  }

  skip(n) {
    if (n && n > 0) {
      this.items = this.items.slice(n);
    }
    return this;
  }

  limit(n) {
    if (n && n > 0) {
      this.items = this.items.slice(0, n);
    }
    return this;
  }

  select(fields) {
    if (typeof fields === "string" && fields.includes("-password")) {
      this.items = this.items.map((item) => {
        const copy = { ...item };
        delete copy.password;
        return copy;
      });
    }
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.items.map(this.docEnhancer)).then(resolve, reject);
  }

  catch(reject) {
    return Promise.resolve(this.items.map(this.docEnhancer)).catch(reject);
  }
}

/**
 * File-backed JSON collection manager
 */
class CollectionStore {
  constructor(filename, enhancer = (d) => d) {
    this.filePath = path.join(DATA_DIR, filename);
    this.enhancer = enhancer;
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), "utf8");
        return [];
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw || "[]");
    } catch (err) {
      console.error(`Error reading ${this.filePath}:`, err);
      return [];
    }
  }

  _save(items) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2), "utf8");
    } catch (err) {
      console.error(`Error saving to ${this.filePath}:`, err);
    }
  }

  find(query = {}) {
    const items = this._load();
    const matched = items.filter((doc) => matchesQuery(doc, query));
    return new LocalQuery(matched, this.enhancer);
  }

  async findOne(query = {}) {
    const items = this._load();
    const doc = items.find((d) => matchesQuery(d, query));
    return doc ? this.enhancer(doc) : null;
  }

  findById(id) {
    if (!id) return null;
    const idStr = id.toString();
    const items = this._load();
    const doc = items.find((d) => d._id && d._id.toString() === idStr);
    return doc ? this.enhancer(doc) : null;
  }

  async countDocuments(query = {}) {
    const items = this._load();
    return items.filter((doc) => matchesQuery(doc, query)).length;
  }

  async insert(rawDoc) {
    const items = this._load();
    const now = new Date().toISOString();
    const doc = {
      ...rawDoc,
      _id: toLocalId(rawDoc._id),
      createdAt: rawDoc.createdAt || now,
      updatedAt: rawDoc.updatedAt || now
    };
    items.push(doc);
    this._save(items);
    return this.enhancer(doc);
  }

  async updateOne(query, update) {
    const items = this._load();
    const index = items.findIndex((d) => matchesQuery(d, query));
    if (index === -1) return null;

    const current = items[index];
    const patch = update.$set ? update.$set : update;
    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    items[index] = updated;
    this._save(items);
    return this.enhancer(updated);
  }

  async updateMany(query, update) {
    const items = this._load();
    let modifiedCount = 0;
    const patch = update.$set ? update.$set : update;
    const now = new Date().toISOString();

    const updatedItems = items.map((doc) => {
      if (matchesQuery(doc, query)) {
        modifiedCount++;
        return {
          ...doc,
          ...patch,
          updatedAt: now
        };
      }
      return doc;
    });

    if (modifiedCount > 0) {
      this._save(updatedItems);
    }

    return { modifiedCount };
  }

  async findOneAndDelete(query) {
    const items = this._load();
    const index = items.findIndex((d) => matchesQuery(d, query));
    if (index === -1) return null;

    const removed = items.splice(index, 1)[0];
    this._save(items);
    return this.enhancer(removed);
  }
}

// === Model Enhancers ===

const enhanceUser = (doc) => {
  const user = { ...doc };
  user._id = toLocalId(doc._id);
  user.toObject = () => ({ ...user });
  user.comparePassword = async (candidate) => {
    return await bcrypt.compare(candidate, user.password);
  };
  return user;
};

const userStore = new CollectionStore("users.json", enhanceUser);

const LocalUser = {
  async findOne(query) {
    const user = await userStore.findOne(query);
    return user;
  },
  findById(id) {
    const user = userStore.findById(id);
    return {
      select(fields) {
        if (fields && fields.includes("-password") && user) {
          const sanitized = { ...user };
          delete sanitized.password;
          return Promise.resolve(sanitized);
        }
        return Promise.resolve(user);
      },
      then(resolve, reject) {
        return Promise.resolve(user).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(user).catch(reject);
      }
    };
  },
  async create(data) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return await userStore.insert({
      ...data,
      password: hashedPassword,
      role: data.role || "user"
    });
  }
};

const enhancePrompt = (doc, store) => {
  const prompt = { ...doc };
  prompt._id = toLocalId(doc._id);
  prompt.userId = toNullableLocalId(doc.userId);
  prompt.toObject = () => ({ ...prompt });
  prompt.save = async () => {
    return await store.updateOne({ _id: prompt._id }, prompt);
  };
  return prompt;
};

const promptStore = new CollectionStore("prompts.json");
promptStore.enhancer = (doc) => enhancePrompt(doc, promptStore);

const LocalPrompt = {
  async create(data) {
    return await promptStore.insert({
      ...data,
      userId: toNullableLocalId(data.userId),
      versions: data.versions || [{ content: data.rawContent }]
    });
  },
  find(filter) {
    return promptStore.find(filter);
  },
  async findOne(query) {
    return await promptStore.findOne(query);
  },
  async findOneAndDelete(query) {
    return await promptStore.findOneAndDelete(query);
  },
  async countDocuments(filter) {
    return await promptStore.countDocuments(filter);
  }
};

const enhanceArtifact = (doc) => {
  const art = { ...doc };
  art._id = toLocalId(doc._id);
  art.userId = toNullableLocalId(doc.userId);
  art.toObject = () => ({ ...art });
  return art;
};

const artifactStore = new CollectionStore("artifacts.json", enhanceArtifact);

const LocalArtifact = {
  async create(data) {
    return await artifactStore.insert({
      ...data,
      userId: toNullableLocalId(data.userId)
    });
  },
  find(query) {
    return artifactStore.find(query);
  },
  async countDocuments(query) {
    return await artifactStore.countDocuments(query);
  }
};

const enhanceGeneration = (doc) => {
  const gen = { ...doc };
  gen._id = toLocalId(doc._id);
  gen.userId = toNullableLocalId(doc.userId);
  gen.toObject = () => ({ ...gen });
  return gen;
};

const generationStore = new CollectionStore("generations.json", enhanceGeneration);

const LocalGeneration = {
  async create(data) {
    return await generationStore.insert({
      ...data,
      userId: toNullableLocalId(data.userId)
    });
  },
  findById(id) {
    const gen = generationStore.findById(id);
    return {
      select() {
        return Promise.resolve(gen);
      },
      then(resolve, reject) {
        return Promise.resolve(gen).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(gen).catch(reject);
      }
    };
  },
  async findOne(query) {
    return await generationStore.findOne(query);
  },
  find(query) {
    return generationStore.find(query);
  },
  async countDocuments(query) {
    return await generationStore.countDocuments(query);
  },
  async findByIdAndUpdate(id, update, options = {}) {
    return await generationStore.updateOne({ _id: id }, update);
  },
  async findOneAndUpdate(query, update, options = {}) {
    return await generationStore.updateOne(query, update);
  },
  async updateMany(query, update) {
    return await generationStore.updateMany(query, update);
  },
  async atomicTransition(generationId, allowedFromStatuses, targetStatus, patch = {}) {
    const items = generationStore._load();
    const idStr = generationId ? generationId.toString() : null;
    const index = items.findIndex((d) => d._id && d._id.toString() === idStr);
    if (index === -1) return null;

    const current = items[index];
    const fromList = allowedFromStatuses.map((s) => s.toString());
    if (!fromList.includes(current.status)) {
      return null;
    }

    const now = new Date().toISOString();
    const updated = {
      ...current,
      status: targetStatus,
      ...patch,
      updatedAt: now
    };

    if (targetStatus === "running" && !patch.startedAt) {
      updated.startedAt = now;
    }

    if (["completed", "failed", "cancelled"].includes(targetStatus)) {
      updated.completedAt = now;
    }

    items[index] = updated;
    generationStore._save(items);
    return enhanceGeneration(updated);
  },
  computePayloadHash(input) {
    const canonical = JSON.stringify({
      subject: (input.subject || "").trim().toLowerCase(),
      action: (input.action || "").trim().toLowerCase(),
      style: (input.style || "").trim().toLowerCase(),
      context: (input.context || "").trim().toLowerCase(),
      complexity: Number(input.complexity) || 3,
      resolution: input.resolution || "16:9",
      modelId: input.modelId || "flux-1-dev",
      seed: input.seed !== null && input.seed !== undefined ? Number(input.seed) : null
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }
};

module.exports = {
  LocalId,
  LocalUser,
  LocalPrompt,
  LocalArtifact,
  LocalGeneration
};

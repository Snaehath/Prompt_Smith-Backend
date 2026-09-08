// Neural Engine Registry & Resolution Policies
const STANDARD_RESOLUTIONS = ["16:9", "1:1", "9:16", "1080x1920", "1920x1080"];

const MODELS = [
  {
    id: "flux-2-klein",
    label: "FLUX.2-klein-4b",
    provider: "nvidia",
    description: "Next-gen ultra-fast distilled neural synthesis (4 steps)",
    isDefault: true,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 4,
    maxSteps: 8,
    minSteps: 1,
    costTier: "fast",
    timeoutMs: 25000,
    supportedResolutions: STANDARD_RESOLUTIONS
  }
];

const getModels = () => MODELS;
const getModelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
const isValidModel = (id) => !id || MODELS.some((m) => m.id === id) || id.startsWith("flux");

module.exports = { getModels, getModelById, isValidModel, MODELS, STANDARD_RESOLUTIONS };

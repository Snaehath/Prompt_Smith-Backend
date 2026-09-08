/**
 * Central Neural Engine Registry & Policy Engine
 * Defines models, hardware capabilities, step limits, and resolution policies.
 */

const STANDARD_RESOLUTIONS = ["16:9", "1:1", "9:16", "1080x1920", "1920x1080"];

const MODELS = [
  {
    id: "flux-1-dev",
    label: "FLUX.1-dev",
    provider: "nvidia",
    description: "Standard high-fidelity text-to-image (50 steps)",
    isDefault: true,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 50,
    maxSteps: 50,
    minSteps: 10,
    costTier: "premium",
    timeoutMs: 35000,
    supportedResolutions: STANDARD_RESOLUTIONS
  },
  {
    id: "flux-1-schnell",
    label: "FLUX.1-schnell",
    provider: "nvidia",
    description: "Fast-track generation (4 steps)",
    isDefault: false,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 4,
    maxSteps: 4,
    minSteps: 1,
    costTier: "fast",
    timeoutMs: 20000,
    supportedResolutions: STANDARD_RESOLUTIONS
  },
  {
    id: "flux-2-klein",
    label: "FLUX.2-klein-4b",
    provider: "nvidia",
    description: "Compact next-gen architecture",
    isDefault: false,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 4,
    maxSteps: 8,
    minSteps: 1,
    costTier: "compact",
    timeoutMs: 25000,
    supportedResolutions: STANDARD_RESOLUTIONS
  },
  {
    id: "pollinations-flux",
    label: "Pollinations FLUX",
    provider: "pollinations",
    description: "High-speed free FLUX cloud inference engine",
    isDefault: false,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 20,
    maxSteps: 50,
    minSteps: 1,
    costTier: "free",
    timeoutMs: 30000,
    supportedResolutions: STANDARD_RESOLUTIONS
  },
  {
    id: "pollinations-turbo",
    label: "Pollinations Turbo",
    provider: "pollinations",
    description: "Ultra-fast SDXL-Turbo real-time synthesizer",
    isDefault: false,
    enabled: true,
    guestAllowed: true,
    defaultSteps: 4,
    maxSteps: 8,
    minSteps: 1,
    costTier: "free",
    timeoutMs: 15000,
    supportedResolutions: STANDARD_RESOLUTIONS
  }
];

const getModels = () => MODELS.filter((m) => m.enabled);
const getModelById = (id) => MODELS.find((m) => m.id === id) || null;
const isValidModel = (id) => MODELS.some((m) => m.id === id && m.enabled);

module.exports = { getModels, getModelById, isValidModel, MODELS, STANDARD_RESOLUTIONS };

/**
 * Central Neural Engine Registry
 * Defines all available models across providers (NVIDIA NIM & Pollinations AI)
 */

const MODELS = [
  {
    id: "flux-1-dev",
    label: "FLUX.1-dev",
    provider: "nvidia",
    description: "Standard high-fidelity text-to-image (50 steps)",
    isDefault: true
  },
  {
    id: "flux-1-schnell",
    label: "FLUX.1-schnell",
    provider: "nvidia",
    description: "Fast-track generation (4 steps)",
    isDefault: false
  },
  {
    id: "flux-2-klein",
    label: "FLUX.2-klein-4b",
    provider: "nvidia",
    description: "Compact next-gen architecture",
    isDefault: false
  },
  {
    id: "pollinations-flux",
    label: "Pollinations FLUX",
    provider: "pollinations",
    description: "High-speed free FLUX cloud inference engine",
    isDefault: false
  },
  {
    id: "pollinations-turbo",
    label: "Pollinations Turbo",
    provider: "pollinations",
    description: "Ultra-fast SDXL-Turbo real-time synthesizer",
    isDefault: false
  }
];

const getModels = () => MODELS;
const getModelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];

module.exports = { getModels, getModelById, MODELS };

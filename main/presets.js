/**
 * Size presets for common platform upload limits.
 * Each preset defines a name, the target in MB, and a description.
 */
// Platform tiers follow the real upload limits (each checked against the
// platform's published limits when added). Keep the renderer mirror in
// renderer/app.js in sync (AGENTS.md: hardcoded presets must match).
const SIZE_PRESETS = [
  { id: 'discord-free', label: 'Discord (Free)', sizeMB: 20, description: '20 MB - Discord free tier' },
  { id: 'discord-nitro-basic', label: 'Discord (Nitro Basic)', sizeMB: 50, description: '50 MB - Discord Nitro Basic' },
  { id: 'discord-nitro', label: 'Discord (Nitro)', sizeMB: 500, description: '500 MB - Discord Nitro' },
  { id: 'x', label: 'X', sizeMB: 512, description: '512 MB - X video upload limit' },
  { id: 'slack', label: 'Slack', sizeMB: 1024, description: '1 GB - Slack file upload limit' },
  { id: 'telegram', label: 'Telegram', sizeMB: 2048, description: '2 GB - Telegram upload limit' },
  { id: 'whatsapp', label: 'WhatsApp', sizeMB: 2048, description: '2 GB - WhatsApp upload limit' },
  { id: 'custom-size', label: 'Custom Target Size', isCustom: true, description: 'Custom file size limit (MB)' }
];

const DEFAULT_PRESET_ID = 'discord-free';

function getPresetById(id) {
  return SIZE_PRESETS.find(p => p.id === id) || null;
}

function getDefaultPreset() {
  return getPresetById(DEFAULT_PRESET_ID);
}

module.exports = { SIZE_PRESETS, DEFAULT_PRESET_ID, getPresetById, getDefaultPreset };

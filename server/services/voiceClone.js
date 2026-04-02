const FormData = require('form-data');
const fs = require('fs');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY;
}

/**
 * Clone a voice using ElevenLabs Instant Voice Cloning
 */
async function cloneVoice(name, filePath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in Railway environment variables.');
  }

  console.log(`🎤 Cloning voice for "${name}" from file: ${filePath}`);
  console.log(`🔑 API key: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 3)}`);

  // Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`📁 File size: ${(fileSize / 1024).toFixed(1)} KB`);

  const form = new FormData();
  form.append('name', `VT_${name}_${Date.now()}`);
  form.append('description', `Cloned voice for ${name}`);
  form.append('files', fs.createReadStream(filePath));

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      ...form.getHeaders(),
    },
    body: form,
  });

  const responseText = await response.text();
  console.log(`📡 ElevenLabs response (${response.status}):`, responseText);

  if (!response.ok) {
    throw new Error(`Voice cloning failed (${response.status}): ${responseText}`);
  }

  const data = JSON.parse(responseText);
  console.log(`✅ Voice cloned! ID: ${data.voice_id}`);
  return data.voice_id;
}

/**
 * Generate speech using a cloned voice
 */
async function generateSpeech(text, voiceId) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs TTS error:', response.status, errText);
    return null;
  }

  // Get audio as buffer
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete a cloned voice from ElevenLabs
 */
async function deleteVoice(voiceId) {
  if (!ELEVENLABS_API_KEY || !voiceId) return;

  try {
    await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
  } catch (err) {
    console.error('Failed to delete voice:', err.message);
  }
}

/**
 * Check remaining character quota
 */
async function getUsageInfo() {
  if (!ELEVENLABS_API_KEY) return null;

  try {
    const response = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      remaining: data.character_limit - data.character_count
    };
  } catch {
    return null;
  }
}

module.exports = { cloneVoice, generateSpeech, deleteVoice, getUsageInfo };

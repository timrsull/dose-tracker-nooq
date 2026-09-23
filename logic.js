// Dose Tracker - Business Logic
// Actions (mutations) and Views (queries)

let nooq;
let call;
let rows;

export async function init() {
  nooq = await NooqClient.createClient();
  call = (name, params) => nooq.call(name, { params });
  rows = async (name, params) => (await call(name, params)).rows;
  return nooq;
}

// ============ VIEWS ============

export const Views = {
  async listMedications() {
    return await rows('listMedications');
  },

  async searchMedications(query) {
    if (!query || query.trim() === '') {
      return await rows('listMedications');
    }
    const result = await nooq.call('searchMedications', {
      filters: ['byName'],
      params: { nameQuery: `%${query}%` }
    });
    return result.rows;
  },

  async getMedication(id) {
    const result = await rows('getMedication', { id });
    return result[0] || null;
  },

  async listDoses(medicationId) {
    return await rows('listDoses', { medicationId });
  },

  async getSetting(key) {
    const result = await rows('getSetting', { key });
    return result[0]?.value || null;
  },

  async getGeminiApiKey() {
    return await Views.getSetting('gemini_api_key');
  },

  async getClaudeApiKey() {
    return await Views.getSetting('claude_api_key');
  },

  async getVisionProvider() {
    return await Views.getSetting('vision_provider') || 'gemini';
  }
};

// ============ ACTIONS ============

export const Actions = {
  async createMedication(name, doseIntervalHours = null) {
    const result = await call('createMedication', {
      name,
      doseIntervalHours
    });
    return { id: result.lastInsertId, name, doseIntervalHours };
  },

  async updateMedication(id, name, doseIntervalHours = null) {
    await call('updateMedication', { id, name, doseIntervalHours });
    return { id, name, doseIntervalHours };
  },

  async deleteMedication(id) {
    await call('deleteDosesForMedication', { medicationId: id });
    await call('deleteMedication', { id });
    return { id };
  },

  async recordDose(medicationId, takenAt = null) {
    const timestamp = takenAt || new Date().toISOString();
    const result = await call('recordDose', {
      medicationId,
      takenAt: timestamp
    });
    return { id: result.lastInsertId, medicationId, takenAt: timestamp };
  },

  async updateDose(id, takenAt) {
    await call('updateDose', { id, takenAt });
    return { id, takenAt };
  },

  async deleteDose(id) {
    await call('deleteDose', { id });
    return { id };
  },

  async setSetting(key, value) {
    await call('setSetting', { key, value });
    return { key, value };
  },

  async deleteSetting(key) {
    await call('deleteSetting', { key });
    return { key };
  },

  async saveGeminiApiKey(apiKey) {
    if (apiKey) {
      await Actions.setSetting('gemini_api_key', apiKey);
    } else {
      await Actions.deleteSetting('gemini_api_key');
    }
  },

  async saveClaudeApiKey(apiKey) {
    if (apiKey) {
      await Actions.setSetting('claude_api_key', apiKey);
    } else {
      await Actions.deleteSetting('claude_api_key');
    }
  },

  async saveVisionProvider(provider) {
    await Actions.setSetting('vision_provider', provider);
  }
};

// ============ DEBUG LOG ============

const debugLog = [];
const MAX_LOG_ENTRIES = 20;

export function getDebugLog() {
  return [...debugLog];
}

export function clearDebugLog() {
  debugLog.length = 0;
}

function addLog(entry) {
  debugLog.unshift({
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (debugLog.length > MAX_LOG_ENTRIES) {
    debugLog.pop();
  }
}

// ============ GEMINI API ============

// images: array of { base64, mimeType }
export async function extractMedicationFromImage(images) {
  // Handle legacy single-image call
  if (!Array.isArray(images)) {
    images = [{ base64: arguments[0], mimeType: arguments[1] }];
  }

  const provider = await Views.getVisionProvider();

  if (provider === 'claude') {
    return await extractWithClaude(images);
  } else {
    return await extractWithGemini(images);
  }
}

async function extractWithGemini(images) {
  const apiKey = await Views.getGeminiApiKey();

  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please add it in Settings.');
  }

  // Use gemini-flash-latest per current quickstart docs
  const model = 'gemini-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.slice(0, 10)}...`;
  const actualEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build parts array with all images
  const parts = [];
  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64
      }
    });
  }

  const imageCountText = images.length > 1
    ? 'These images show different sides of the same medication container. Combine all visible information.'
    : '';

  parts.push({
    text: `You are analyzing medication packaging images. Extract the medication name and dosing interval.
${imageCountText}

RESPOND WITH ONLY THIS JSON FORMAT - NO OTHER TEXT:
{"name": "Medication Name", "intervalHours": 6}

Rules:
- name: Always format as "Brand Name (Generic Name)" using your knowledge of medications. For example, if you see "Acetaminophen 500mg", return "Tylenol (Acetaminophen)". If you see "Ibuprofen", return "Advil (Ibuprofen)". Include the most common US brand name even if only the generic name is visible on the packaging.
- intervalHours: Convert dosing instructions to hours. Examples: "every 4-6 hours" = 5, "twice daily" = 12, "three times daily" = 8, "once daily" = 24. Use null if not specified on packaging.
- If unreadable or not medication: {"error": "Could not identify medication"}`
  });

  const requestBody = {
    contents: [{
      parts: parts
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024
    }
  };

  addLog({
    type: 'request',
    method: 'POST',
    url: endpoint,
    imageCount: images.length,
    body: { ...requestBody, contents: [{ parts: images.map(img => `[image: ${img.mimeType}]`).concat([parts[parts.length - 1]]) }] }
  });

  let response;
  try {
    response = await fetch(actualEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (fetchError) {
    addLog({
      type: 'error',
      error: `Network error: ${fetchError.message}`
    });
    throw fetchError;
  }

  const responseText = await response.text();

  addLog({
    type: 'response',
    status: response.status,
    statusText: response.statusText,
    body: responseText.slice(0, 1000) + (responseText.length > 1000 ? '...' : '')
  });

  if (!response.ok) {
    console.error('Gemini API error:', responseText);
    try {
      const errorJson = JSON.parse(responseText);
      throw new Error(errorJson.error?.message || `API error: ${response.status}`);
    } catch (e) {
      if (e.message.startsWith('API error:') || e.message.includes('API')) {
        throw e;
      }
      throw new Error(`API error: ${response.status} - ${responseText.slice(0, 200)}`);
    }
  }

  const result = JSON.parse(responseText);
  let textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent) {
    throw new Error('No response from Gemini');
  }

  // Strip markdown code fences if present
  textContent = textContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Parse JSON from response - find the JSON object even if surrounded by text
  const jsonMatch = textContent.match(/\{[^{}]*\}/);
  if (!jsonMatch) {
    addLog({
      type: 'error',
      error: 'No JSON found in response',
      rawText: textContent.slice(0, 500)
    });
    throw new Error('Invalid response format - no JSON in response');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    addLog({
      type: 'error',
      error: 'JSON parse failed',
      rawText: jsonMatch[0]
    });
    throw new Error('Invalid response format - malformed JSON');
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  addLog({
    type: 'parsed',
    result: parsed
  });

  return {
    name: parsed.name || '',
    intervalHours: parsed.intervalHours
  };
}

// ============ CLAUDE API ============

async function extractWithClaude(images) {
  const apiKey = await Views.getClaudeApiKey();

  if (!apiKey) {
    throw new Error('Claude API key not configured. Please add it in Settings.');
  }

  const endpoint = 'https://api.anthropic.com/v1/messages';

  const imageCountText = images.length > 1
    ? 'These images show different sides of the same medication container. Combine all visible information.'
    : '';

  const promptText = `You are analyzing medication packaging images. Extract the medication name and dosing interval.
${imageCountText}

RESPOND WITH ONLY THIS JSON FORMAT - NO OTHER TEXT:
{"name": "Medication Name", "intervalHours": 6}

Rules:
- name: Always format as "Brand Name (Generic Name)" using your knowledge of medications. For example, if you see "Acetaminophen 500mg", return "Tylenol (Acetaminophen)". If you see "Ibuprofen", return "Advil (Ibuprofen)". Include the most common US brand name even if only the generic name is visible on the packaging.
- intervalHours: Convert dosing instructions to hours. Examples: "every 4-6 hours" = 5, "twice daily" = 12, "three times daily" = 8, "once daily" = 24. Use null if not specified on packaging.
- If unreadable or not medication: {"error": "Could not identify medication"}`;

  // Build content array with images and text
  const content = [];
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType,
        data: img.base64
      }
    });
  }
  content.push({
    type: 'text',
    text: promptText
  });

  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: content
    }]
  };

  addLog({
    type: 'request',
    method: 'POST',
    url: endpoint,
    provider: 'claude',
    imageCount: images.length,
    body: { ...requestBody, messages: [{ role: 'user', content: images.map(img => `[image: ${img.mimeType}]`).concat([promptText]) }] }
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (fetchError) {
    addLog({
      type: 'error',
      error: `Network error: ${fetchError.message}`
    });
    throw fetchError;
  }

  const responseText = await response.text();

  addLog({
    type: 'response',
    status: response.status,
    statusText: response.statusText,
    provider: 'claude',
    body: responseText.slice(0, 1000) + (responseText.length > 1000 ? '...' : '')
  });

  if (!response.ok) {
    console.error('Claude API error:', responseText);
    try {
      const errorJson = JSON.parse(responseText);
      throw new Error(errorJson.error?.message || `API error: ${response.status}`);
    } catch (e) {
      if (e.message.startsWith('API error:') || e.message.includes('API')) {
        throw e;
      }
      throw new Error(`API error: ${response.status} - ${responseText.slice(0, 200)}`);
    }
  }

  const result = JSON.parse(responseText);
  let textContent = result.content?.[0]?.text;

  if (!textContent) {
    throw new Error('No response from Claude');
  }

  // Strip markdown code fences if present
  textContent = textContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Parse JSON from response
  const jsonMatch = textContent.match(/\{[^{}]*\}/);
  if (!jsonMatch) {
    addLog({
      type: 'error',
      error: 'No JSON found in response',
      rawText: textContent.slice(0, 500)
    });
    throw new Error('Invalid response format - no JSON in response');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    addLog({
      type: 'error',
      error: 'JSON parse failed',
      rawText: jsonMatch[0]
    });
    throw new Error('Invalid response format - malformed JSON');
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  addLog({
    type: 'parsed',
    result: parsed,
    provider: 'claude'
  });

  return {
    name: parsed.name || '',
    intervalHours: parsed.intervalHours
  };
}

// ============ HELPERS ============

export function calculateNextDose(lastDoseAt, intervalHours) {
  if (!lastDoseAt || !intervalHours) return null;
  const lastDose = new Date(lastDoseAt);
  const nextDose = new Date(lastDose.getTime() + intervalHours * 60 * 60 * 1000);
  return nextDose;
}

export function formatTimeUntil(targetDate) {
  if (!targetDate) return null;
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();

  if (diff <= 0) return 'Available now';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatDateTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  return date.toLocaleString();
}

export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

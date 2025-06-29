import crypto from 'crypto';

const {
  KOMMO_SUBDOMAIN,
  KOMMO_ACCESS_TOKEN,
  FACEBOOK_ACCESS_TOKEN,
  FACEBOOK_PIXEL_ID,
  EVENT_NAME,
  PHONE_FIELD_ID,
  FBC_FIELD_ID
} = process.env;

/** Normaliza y hashea en SHA-256 un valor de texto */
function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex');
}

export default async function handler(req, res) {
  // 👉 Permitimos GET solo para verificar que la función está viva
  if (req.method === 'GET') {
    return res
      .status(200)
      .send('✅ Kommo → Meta CAPI webhook is up and running. Use POST to send leads.');
  }

  // Solo procesamos POST para el webhook
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { object_id: leadId } = req.body;
    if (!leadId) {
      return res.status(400).json({ error: 'Falta object_id en el body' });
    }

    // 1) Traer custom_fields del lead desde Kommo
    const kommoUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
    const kommoResp = await fetch(kommoUrl, {
      headers: { Authorization: `Bearer ${KOMMO_ACCESS_TOKEN}` }
    });
    if (!kommoResp.ok) {
      throw new Error(`Kommo API status ${kommoResp.status}`);
    }
    const kommoData = await kommoResp.json();
    const customFields = kommoData.custom_fields_values || [];

    // 2) Extraer teléfono y FBCLID
    const rawPhone = customFields
      .find(f => String(f.field_id) === PHONE_FIELD_ID)
      ?.values?.[0]?.value || '';
    const digits = rawPhone.replace(/\D/g, '');
    const phoneHash = digits ? sha256(digits) : null;

    const fbc = customFields
      .find(f => String(f.field_id) === FBC_FIELD_ID)
      ?.values?.[0]?.value || null;

    // 3) Capturar user-agent e IP
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress ||
      null
    );

    // 4) Armar evento para Meta CAPI
    const event = {
      event_name:    EVENT_NAME,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        ph:                phoneHash,
        fbc,
        client_user_agent: userAgent,
        client_ip_address: ipAddress,
        external_id:       leadId
      }
    };

    // 5) Enviar a Meta Conversions API
    const capiUrl = `https://graph.facebook.com/v14.0/${FACEBOOK_PIXEL_ID}/events`;
    const capiResp = await fetch(`${capiUrl}?access_token=${FACEBOOK_ACCESS_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ data: [event] })
    });
    if (!capiResp.ok) {
      const errText = await capiResp.text();
      throw new Error(`CAPI status ${capiResp.status}: ${errText}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error en CAPI o Kommo API:', err);
    return res.status(500).json({ error: err.message });
  }
}

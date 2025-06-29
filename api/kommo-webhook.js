import axios from 'axios';
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const { object_id: leadId } = req.body;
    if (!leadId) {
      return res.status(400).json({ error: 'Falta object_id en el body' });
    }

    // 1) Traer custom_fields_values del lead desde Kommo
    const kommoUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
    const kommoResp = await axios.get(kommoUrl, {
      headers: { Authorization: `Bearer ${KOMMO_ACCESS_TOKEN}` }
    });
    const customFields = kommoResp.data.custom_fields_values || [];

    // 2) Extraer teléfono y fbclid
    const rawPhone = customFields
      .find(f => String(f.field_id) === PHONE_FIELD_ID)
      ?.values?.[0]?.value || '';
    const phoneDigits = rawPhone.replace(/\D/g, '');
    const phoneHash = phoneDigits ? sha256(phoneDigits) : null;

    const fbc = customFields
      .find(f => String(f.field_id) === FBC_FIELD_ID)
      ?.values?.[0]?.value || null;

    // 3) Capturar user-agent e IP de la petición
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress ||
      null
    );

    // 4) Armar el evento para Meta CAPI
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
    await axios.post(capiUrl, {
      data:         [event],
      access_token: FACEBOOK_ACCESS_TOKEN
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error en CAPI o Kommo API:', err.response?.data || err.message);
    return res.status(500).json({
      error: err.response?.data || err.message
    });
  }
}

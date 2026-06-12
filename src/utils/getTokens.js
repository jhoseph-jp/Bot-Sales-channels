/**
 * Troca o authorization_code pelo access_token + refresh_token do ML.
 *
 * Uso:
 *   node src/utils/getTokens.js <code_da_url_de_callback>
 *
 * O código vem da URL após autorizar o app:
 *   https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...
 */

require('dotenv').config();
const axios = require('axios');

async function getTokens(code) {
  const clientId     = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri  = process.env.ML_REDIRECT_URI || 'https://ofertadelas.com.br/auth/callback';

  if (!clientId || !clientSecret) {
    console.error('Defina ML_CLIENT_ID e ML_CLIENT_SECRET no arquivo .env');
    process.exit(1);
  }

  try {
    console.log('Trocando código por tokens...');
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type  : 'authorization_code',
      client_id   : clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    console.log('Tokens obtidos com sucesso!');
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Erro ao obter tokens:', error.response?.data || error.message);
    process.exit(1);
  }
}

const code = process.argv[2];
if (!code) {
  console.error('Uso: node src/utils/getTokens.js <code>');
  process.exit(1);
}

getTokens(code);

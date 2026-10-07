import { defineConfig } from 'wxt';

// Chave PUBLICA de desenvolvimento: fixa o id da extensao carregada sem
// empacotar (fjmlahaidjmkfiogbmklmnhcaadkmfck), o mesmo que entra no CORS do
// backend e no allowed_origins do Clerk. A loja da outro id; ao publicar, a
// chave publica da loja substitui esta. A chave privada fica em _local/.
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2UzjI81sPiaTGtO1URepRjYR3FyuBhvy' +
  '9J14nU3pUzdskcUCGEPvO5RiNW5JbNqrolMQkzwKPsWk1aSzH88wt3q1MZ4mtyD234xleXjk7a2k' +
  'c5rT0RCRQCLsc88ol1aoM+pofNwwBrjxXcSgCTCaxWYvjwBLRRgs3/q9SL6BuO/m3Ux53MJ9ZL/K' +
  'd+m1EC7fV3PW74f7iozA01i2XVTmMfCrIjzOvgSFo5KlLHz+Nv2dTibMAkp2AnnKUEvDHvlseZQ6' +
  '3qUqh6G8Kc9ioCAVtekk5sTGK0jL+urY9FJOUT6MLd2lNnM6N4idfjIPwNWWx9mWsvQH8lqNm3Ks' +
  'iFAOCQIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tickrify',
    description: 'Analyze the chart you have open in one click. No more screenshots.',
    key: DEV_PUBLIC_KEY,
    action: {
      default_title: 'Analyze this chart with Tickrify (Alt+Shift+T)',
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Analyze the chart on this tab',
      },
    },
    // Sem host permission de nenhuma plataforma: a captura usa activeTab (so
    // depois do clique do trader). clerk.tickrify.com e exigencia do login
    // sincronizado com o site (o Clerk le o cookie de sessao de la).
    permissions: ['activeTab', 'scripting', 'storage', 'cookies', 'contextMenus', 'alarms', 'notifications'],
    host_permissions: ['https://clerk.tickrify.com/*'],
  },
});

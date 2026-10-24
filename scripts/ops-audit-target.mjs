const TRUSTED_OPS_ORIGIN = 'https://tickrify.onrender.com';

// A origem autorizada fica no código, nunca em um input do workflow.
export function assertTrustedOpsTarget(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Destino do token operacional inválido.');
  }

  if (target.origin !== TRUSTED_OPS_ORIGIN || target.username || target.password) {
    throw new Error('O token operacional só pode ser enviado à API HTTPS oficial.');
  }
}

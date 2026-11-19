const fs = require('node:fs');

const themes = new Set(['system', 'light', 'dark']);

function loadTheme(file) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (themes.has(value)) return value;
  } catch { /* Use the system setting if no preference can be read. */ }
  return 'system';
}

function saveTheme(file, value) {
  if (!themes.has(value)) throw new Error('Tema inválido.');
  const temporary = `${file}.tmp`;
  try {
    fs.writeFileSync(temporary, `${value}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch {
    throw new Error('Não foi possível salvar o tema neste computador.');
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
  }
  return value;
}

module.exports = { loadTheme, saveTheme };

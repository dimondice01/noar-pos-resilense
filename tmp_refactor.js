const fs = require('fs');
const path = require('path');

const UI_FILES = [
  'src/modules/dashboard/pages/DashboardPage.jsx',
  'src/modules/sales/pages/SalesPage.jsx',
  'src/modules/cash/pages/CashPage.jsx',
  'src/modules/cash/components/CashClosingModal.jsx',
  'src/modules/reports/components/TicketZModal.jsx'
];

const basePath = 'c:\\Users\\subli\\OneDrive\\Desktop\\mia\\noar-pos-resilense';

UI_FILES.forEach(relPath => {
  const fullPath = path.join(basePath, relPath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');

  // Reemplazar fondos
  content = content.replace(/\bbg-white\b/g, 'bg-surface');
  content = content.replace(/\bbg-slate-50\b/g, 'bg-background');
  content = content.replace(/\bbg-slate-100\b/g, 'bg-background hover:bg-surface');
  content = content.replace(/\bbg-sys-50\b/g, 'bg-background');
  content = content.replace(/\bbg-sys-100\b/g, 'bg-background');
  
  // Reemplazar textos principales
  content = content.replace(/\btext-slate-900\b/g, 'text-primary');
  content = content.replace(/\btext-slate-800\b/g, 'text-primary');
  content = content.replace(/\btext-slate-700\b/g, 'text-primary block'); // para diferenciar un poco, mmm, just text-primary
  content = content.replace(/\btext-sys-900\b/g, 'text-primary');
  content = content.replace(/\btext-sys-800\b/g, 'text-primary');

  // Reemplazar textos secundarios
  content = content.replace(/\btext-slate-500\b/g, 'text-secondary');
  content = content.replace(/\btext-slate-400\b/g, 'text-secondary/80');
  content = content.replace(/\btext-sys-500\b/g, 'text-secondary');
  content = content.replace(/\btext-sys-400\b/g, 'text-secondary/80');

  // Reemplazar bordes
  content = content.replace(/\bborder-slate-100\b/g, 'border-border');
  content = content.replace(/\bborder-slate-200\b/g, 'border-border');
  content = content.replace(/\bborder-slate-300\b/g, 'border-border');
  content = content.replace(/\bborder-sys-100\b/g, 'border-border');
  content = content.replace(/\bborder-sys-200\b/g, 'border-border');

  // Remover manual dark: classes que interfieren
  content = content.replace(/\bdark:bg-slate-[0-9]+\b/g, '');
  content = content.replace(/\bdark:text-slate-[0-9]+\b/g, '');
  content = content.replace(/\bdark:border-slate-[0-9]+\b/g, '');
  content = content.replace(/\bdark:bg-sys-[0-9]+\b/g, '');
  content = content.replace(/\bdark:border-sys-[0-9]+\b/g, '');

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✅ Refactored: ${relPath}`);
});

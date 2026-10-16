import * as fs from 'fs/promises';
import * as path from 'path';

export async function prepareDashboard(folder: string): Promise<number> {
  let count = 0;
  const loader = '<script src="/dashboard/bootstrap.js"></script>';
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      count += await prepareDashboard(file);
    } else if (entry.name.endsWith('.html')) {
      const content = await fs.readFile(file, 'utf8');
      if (!content.includes('<head>')) {
        throw new Error(`Dashboard HTML has no head element: ${file}`);
      }
      if (!content.includes(loader)) {
        await fs.writeFile(file, content.replace('<head>', `<head>${loader}`));
      }
      count += 1;
    }
  }
  return count;
}

if (require.main === module) {
  prepareDashboard(process.argv[2])
    .then(function(count) {
      if (!count) {
        throw new Error('No Dashboard HTML files found');
      }
    })
    .catch(function(error) {
      console.error(error.message);
      process.exitCode = 1;
    });
}

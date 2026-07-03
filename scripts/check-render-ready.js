const urls = process.argv.slice(2);

if (!urls.length) {
  console.error('Usage: node scripts/check-render-ready.js https://service-a.onrender.com https://service-b.onrender.com');
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  let failed = false;
  for (const rawUrl of urls) {
    const baseUrl = rawUrl.replace(/\/+$/, '');
    try {
      const response = await fetch(`${baseUrl}/readyz`, { headers: { accept: 'application/json' } });
      const body = await response.json();
      const sessionEnabled = body.redis?.features?.sessionStore?.enabled;
      const socketEnabled = body.redis?.features?.socketAdapter?.enabled;
      const ok = response.ok && body.ok && body.db?.ok && body.redis?.ok && sessionEnabled === true && socketEnabled === true;
      if (!ok) failed = true;
      console.log(
        [
          baseUrl,
          `status=${response.status}`,
          `ok=${Boolean(body.ok)}`,
          `db=${Boolean(body.db?.ok)}`,
          `redis=${Boolean(body.redis?.ok)}`,
          `sessionStore=${sessionEnabled}`,
          `socketAdapter=${socketEnabled}`,
        ].join(' '),
      );
    } catch (error) {
      failed = true;
      console.error(`${baseUrl} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed) process.exit(1);
}

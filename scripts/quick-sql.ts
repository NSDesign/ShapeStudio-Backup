
#!/usr/bin/env tsx
import { db } from '../server/db';

async function runQuery(sql: string) {
  try {
    const result = await db.execute(sql);
    console.log('Query result:', result);
  } catch (error) {
    console.error('Query error:', error);
  }
  process.exit(0);
}

const query = process.argv[2];
if (!query) {
  console.log('Usage: tsx scripts/quick-sql.ts "SELECT * FROM users;"');
  process.exit(1);
}

runQuery(query);

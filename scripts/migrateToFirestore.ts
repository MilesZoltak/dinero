import fs from 'fs';
import path from 'path';
import { dbAdapter } from '../src/lib/db';

async function migrate() {
  console.log('Starting migration from data/db.json to Cloud Firestore...');
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  if (!fs.existsSync(dbPath)) {
    console.log('No local data/db.json found. Skipping migration.');
    return;
  }

  const raw = fs.readFileSync(dbPath, 'utf8');
  const data = JSON.parse(raw);

  if (data.accounts && data.accounts.length > 0) {
    console.log(`Migrating ${data.accounts.length} accounts...`);
    for (const acc of data.accounts) {
      await dbAdapter.saveAccount(acc);
    }
  }

  if (data.transactions && data.transactions.length > 0) {
    console.log(`Migrating ${data.transactions.length} transactions...`);
    await dbAdapter.saveTransactions(data.transactions);
  }

  if (data.categoryRules && data.categoryRules.length > 0) {
    console.log(`Migrating ${data.categoryRules.length} category rules...`);
    for (const rule of data.categoryRules) {
      await dbAdapter.saveCategoryRule(rule);
    }
  }

  if (data.plaidItems && data.plaidItems.length > 0) {
    console.log(`Migrating ${data.plaidItems.length} Plaid items...`);
    for (const item of data.plaidItems) {
      await dbAdapter.savePlaidItem(item);
    }
  }

  if (data.simpleFinConnections && data.simpleFinConnections.length > 0) {
    console.log(`Migrating ${data.simpleFinConnections.length} SimpleFIN connections...`);
    for (const conn of data.simpleFinConnections) {
      await dbAdapter.saveSimpleFinConnection(conn);
    }
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);

#!/usr/bin/env tsx
import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq } from 'drizzle-orm';

console.log('🔐 Testing Real-time Access Control');
console.log('==================================');

async function testAccessControl() {
  try {
    // 1. Show current authorized users
    console.log('\n📋 Current authorized users in database:');
    const allUsers = await db.select().from(users);
    allUsers.forEach((user, index) => {
      console.log(`${index + 1}. ID: ${user.id}, Email: ${user.email}`);
    });

    // 2. Show active sessions (simplified)
    console.log('\n🔑 Active authentication sessions:');
    const sessionsResult = await db.execute(`
      SELECT sess->'passport'->'user'->'claims'->>'sub' as user_id,
             sess->'passport'->'user'->'claims'->>'email' as email
      FROM sessions 
      WHERE sess->'passport'->'user' IS NOT NULL
    `);
    
    const sessions = sessionsResult.rows as any[];
    
    sessions.forEach((session: any, index) => {
      console.log(`${index + 1}. Session User ID: ${session.user_id}, Email: ${session.email}`);
    });

    // 3. Check for mismatches
    console.log('\n⚠️  Checking for access control mismatches...');
    let mismatchFound = false;

    for (const session of sessions) {
      const userId = session.user_id;
      const userInDb = allUsers.find(u => u.id === userId);
      
      if (!userInDb) {
        console.log(`❌ MISMATCH: User ${userId} (${session.email}) has active session but is NOT in database`);
        mismatchFound = true;
      }
    }

    if (!mismatchFound) {
      console.log('✅ All authenticated users are properly authorized in database');
    }

    console.log('\n📖 Access Control Behavior:');
    console.log('• New logins: Only database users can authenticate');
    console.log('• Existing sessions: Checked on every API request');
    console.log('• If user removed from database: Next API call will return 401 and force logout');
    console.log('• Sessions are automatically invalidated when user is removed');

  } catch (error) {
    console.error('❌ Error testing access control:', error);
  }
}

async function clearAllSessions() {
  console.log('\n🧹 Clearing all sessions (force logout all users)...');
  await db.execute('DELETE FROM sessions');
  console.log('✅ All sessions cleared - all users will need to re-authenticate');
}

async function main() {
  await testAccessControl();
  
  if (process.argv.includes('--clear-sessions')) {
    await clearAllSessions();
  }
}

main().then(() => {
  console.log('\n💡 To clear all sessions: tsx scripts/test-access-control.ts --clear-sessions');
  process.exit(0);
}).catch(console.error);
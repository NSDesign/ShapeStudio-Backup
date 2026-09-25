
#!/usr/bin/env tsx
import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';

async function clearAllUsers() {
  try {
    const result = await db.delete(users).returning();
    console.log(`✅ Deleted ${result.length} users`);
  } catch (error) {
    console.error('❌ Error clearing users:', error);
  }
}

async function deleteUsersByIds(userIds: string[]) {
  try {
    const result = await db.delete(users).where(inArray(users.id, userIds)).returning();
    console.log(`✅ Deleted ${result.length} users:`, result.map(u => u.email));
  } catch (error) {
    console.error('❌ Error deleting users:', error);
  }
}

async function deleteUserById(userId: string) {
  try {
    const result = await db.delete(users).where(eq(users.id, userId)).returning();
    if (result.length > 0) {
      console.log('✅ User deleted:', result[0]);
    } else {
      console.log('❌ User not found:', userId);
    }
  } catch (error) {
    console.error('❌ Error deleting user:', error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'clear-all':
      console.log('⚠️  This will delete ALL users. Are you sure?');
      await clearAllUsers();
      break;
    
    case 'delete-id':
      if (args.length < 2) {
        console.log('Usage: tsx scripts/cleanup-users.ts delete-id <user-id>');
        process.exit(1);
      }
      await deleteUserById(args[1]);
      break;
    
    case 'delete-multiple':
      if (args.length < 2) {
        console.log('Usage: tsx scripts/cleanup-users.ts delete-multiple <id1> <id2> ...');
        process.exit(1);
      }
      await deleteUsersByIds(args.slice(1));
      break;
    
    default:
      console.log('Available commands:');
      console.log('  clear-all - Delete all users (dangerous!)');
      console.log('  delete-id <user-id> - Delete specific user by ID');
      console.log('  delete-multiple <id1> <id2> ... - Delete multiple users by IDs');
      console.log('');
      console.log('Examples:');
      console.log('  tsx scripts/cleanup-users.ts delete-id 21294');
      console.log('  tsx scripts/cleanup-users.ts delete-multiple 21294 44963660');
      console.log('  tsx scripts/cleanup-users.ts clear-all');
      break;
  }
  
  process.exit(0);
}

main().catch(console.error);

#!/usr/bin/env tsx
import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function addUser(id: string, email: string, firstName?: string, lastName?: string) {
  try {
    const [user] = await db
      .insert(users)
      .values({
        id,
        email,
        firstName,
        lastName,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    console.log('✅ User added successfully:', user);
  } catch (error) {
    console.error('❌ Error adding user:', error);
  }
}

async function removeUser(identifier: string) {
  try {
    // Try to remove by ID first, then by email
    let result = await db.delete(users).where(eq(users.id, identifier)).returning();
    
    if (result.length === 0) {
      result = await db.delete(users).where(eq(users.email, identifier)).returning();
    }
    
    if (result.length > 0) {
      console.log('✅ User removed successfully:', result[0]);
    } else {
      console.log('❌ User not found with identifier:', identifier);
    }
  } catch (error) {
    console.error('❌ Error removing user:', error);
  }
}

async function listUsers() {
  try {
    const allUsers = await db.select().from(users);
    console.log('📋 Current users:');
    allUsers.forEach((user, index) => {
      console.log(`${index + 1}. ID: ${user.id}, Email: ${user.email}, Name: ${user.firstName || 'N/A'} ${user.lastName || 'N/A'}`);
    });
  } catch (error) {
    console.error('❌ Error listing users:', error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'add':
      if (args.length < 3) {
        console.log('Usage: npm run manage-users add <id> <email> [firstName] [lastName]');
        process.exit(1);
      }
      await addUser(args[1], args[2], args[3], args[4]);
      break;
    
    case 'remove':
      if (args.length < 2) {
        console.log('Usage: npm run manage-users remove <id-or-email>');
        process.exit(1);
      }
      await removeUser(args[1]);
      break;
    
    case 'list':
      await listUsers();
      break;
    
    default:
      console.log('Available commands:');
      console.log('  add <id> <email> [firstName] [lastName] - Add a new user');
      console.log('  remove <id-or-email> - Remove a user by ID or email');
      console.log('  list - List all users');
      console.log('');
      console.log('Examples:');
      console.log('  npm run manage-users add user123 john@example.com John Doe');
      console.log('  npm run manage-users remove user123');
      console.log('  npm run manage-users list');
      break;
  }
  
  process.exit(0);
}

main().catch(console.error);
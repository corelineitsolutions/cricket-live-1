import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD is empty. Admin seed skipped.');
    return;
  }

  if (password.length < 8) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be at least 8 characters.');
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log('Admin already exists. Password was left unchanged.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.admin.create({
    data: {
      email,
      passwordHash,
      isActive: true,
    },
  });

  console.log('Initial admin created.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Admin seed failed';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

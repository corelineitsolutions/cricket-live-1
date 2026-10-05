import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AdminsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.admin.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true, passwordHash: true },
    });
  }

  findById(id: string) {
    return this.prisma.admin.findUnique({
      where: { id },
      select: { id: true, email: true, isActive: true },
    });
  }
}

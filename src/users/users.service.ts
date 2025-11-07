import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayColor: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getPublicProfile(userId: string): Promise<PublicUser> {
    const user = await this.getById(userId);
    return this.stripSensitive(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const data: Partial<{ username: string; displayColor: string }> = {};

    if (dto.username) {
      const existing = await this.prisma.user.findFirst({
        where: {
          id: { not: userId },
          username: {
            equals: dto.username,
            mode: 'insensitive',
          },
        },
      });
      if (existing) {
        throw new ConflictException('Username already in use');
      }
      data.username = dto.username;
    }

    if (dto.displayColor) {
      data.displayColor = dto.displayColor;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.stripSensitive(updated);
  }

  async listUsers(excludeUserId?: string): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({
      where: excludeUserId
        ? {
            id: {
              not: excludeUserId,
            },
          }
        : undefined,
      orderBy: {
        username: 'asc',
      },
    });

    return users.map((user) => this.stripSensitive(user));
  }

  stripSensitive(user: { id: string; email: string; username: string; displayColor: string; createdAt: Date; updatedAt: Date }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayColor: user.displayColor,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}


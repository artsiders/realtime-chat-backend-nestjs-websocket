import { randomUUID } from 'crypto';
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    const { email, password, username, displayColor } = dto;

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: email.toLowerCase() },
          { username: { equals: username, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('Email or username already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        displayColor: displayColor ?? '#3b82f6',
        password,
      },
    });

    await this.ensureGeneralRoomMembership(user.id);
    return this.buildAuthResponse(user.id);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.password !== dto.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user.id);
  }

  private async buildAuthResponse(userId: string) {
    const token = randomUUID();
    await this.prisma.session.create({
      data: {
        token,
        userId,
      },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayColor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      accessToken: token,
      user,
    };
  }

  async validateToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid token');
    }

    const { password, ...user } = session.user;
    return user;
  }

  private async ensureGeneralRoomMembership(userId: string) {
    let generalRoom = await this.prisma.room.findFirst({ where: { isGeneral: true } });
    if (!generalRoom) {
      generalRoom = await this.prisma.room.create({
        data: {
          name: 'General',
          isGeneral: true,
          createdById: userId,
        },
      });
    }

    await this.prisma.roomMember.upsert({
      where: {
        roomId_userId: {
          roomId: generalRoom.id,
          userId,
        },
      },
      update: {
        canAccessHistory: true,
      },
      create: {
        roomId: generalRoom.id,
        userId,
        canAccessHistory: true,
      },
    });
  }
}


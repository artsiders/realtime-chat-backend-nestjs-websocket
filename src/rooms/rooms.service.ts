import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { AddMembersDto } from './dto/add-members.dto';

interface AddUserToRoomOptions {
  roomId: string;
  userId: string;
  canAccessHistory: boolean;
}

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureGeneralRoom(initialCreatorId?: string) {
    const existing = await this.prisma.room.findFirst({ where: { isGeneral: true } });
    if (existing) {
      return existing;
    }

    if (!initialCreatorId) {
      throw new Error('General room cannot be created without a creator');
    }

    return this.prisma.room.create({
      data: {
        name: 'General',
        isGeneral: true,
        createdById: initialCreatorId,
      },
    });
  }

  async addUserToRoom({ roomId, userId, canAccessHistory }: AddUserToRoomOptions) {
    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (membership) {
      return membership;
    }

    return this.prisma.roomMember.create({
      data: {
        roomId,
        userId,
        canAccessHistory,
      },
    });
  }

  async listRoomsForUser(userId: string) {
    const rooms = await this.prisma.roomMember.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            members: {
              include: {
                user: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    return rooms.map((membership) => ({
      id: membership.room.id,
      name: membership.room.name,
      isGeneral: membership.room.isGeneral,
      membership: {
        canAccessHistory: membership.canAccessHistory,
        joinedAt: membership.joinedAt,
      },
      members: membership.room.members.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        displayColor: member.user.displayColor,
      })),
    }));
  }

  async createRoom(creatorId: string, dto: CreateRoomDto) {
    const uniqueMemberIds = Array.from(new Set([creatorId, ...dto.memberIds]));

    const room = await this.prisma.room.create({
      data: {
        name: dto.name,
        isGeneral: false,
        createdById: creatorId,
        members: {
          create: uniqueMemberIds.map((userId) => ({
            userId,
            canAccessHistory: userId === creatorId ? true : dto.shareHistoryWithNewMembers ?? false,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    return {
      id: room.id,
      name: room.name,
      isGeneral: room.isGeneral,
      members: room.members.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        displayColor: member.user.displayColor,
      })),
    };
  }

  async addMembers(roomId: string, actorId: string, dto: AddMembersDto) {
    await this.ensureActorInRoom(roomId, actorId);

    const uniqueUserIds = Array.from(new Set(dto.userIds));

    await this.prisma.roomMember.createMany({
      data: uniqueUserIds.map((userId) => ({
        roomId,
        userId,
        canAccessHistory: dto.shareHistoryWithNewMembers ?? false,
        joinedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    if (dto.shareHistoryWithNewMembers) {
      await this.prisma.roomMember.updateMany({
        where: {
          roomId,
          userId: { in: uniqueUserIds },
        },
        data: {
          canAccessHistory: true,
        },
      });
    }

    const members = await this.prisma.roomMember.findMany({
      where: { roomId, userId: { in: uniqueUserIds } },
      include: { user: true },
    });

    return members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      displayColor: member.user.displayColor,
      canAccessHistory: member.canAccessHistory,
      joinedAt: member.joinedAt,
    }));
  }

  async getMessagesForUser(roomId: string, userId: string, limit = 50, cursor?: { id: string }) {
    const membership = await this.ensureActorInRoom(roomId, userId);

    const where: Prisma.MessageWhereInput = { roomId };
    if (!membership.canAccessHistory) {
      where.createdAt = { gte: membership.joinedAt };
    }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor.id },
          }
        : {}),
      include: {
        sender: true,
        reactions: {
          include: {
            user: true,
          },
        },
      },
    });

    return messages.reverse().map((message) => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      roomId: message.roomId,
      sender: {
        id: message.sender.id,
        username: message.sender.username,
        displayColor: message.sender.displayColor,
      },
      reactions: message.reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        user: {
          id: reaction.user.id,
          username: reaction.user.username,
          displayColor: reaction.user.displayColor,
        },
      })),
    }));
  }

  async createMessage(roomId: string, senderId: string, content: string) {
    await this.ensureActorInRoom(roomId, senderId);

    const trimmed = content?.trim();
    if (!trimmed) {
      throw new BadRequestException('Message cannot be empty');
    }

    const message = await this.prisma.message.create({
      data: {
        roomId,
        senderId,
        content: trimmed,
      },
      include: {
        sender: true,
        reactions: {
          include: {
            user: true,
          },
        },
      },
    });

    return this.formatMessage(message);
  }

  async addReaction(messageId: string, userId: string, emoji: string) {
    const normalizedEmoji = emoji?.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required');
    }
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { room: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.ensureActorInRoom(message.roomId, userId);

    await this.prisma.messageReaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji: normalizedEmoji,
        },
      },
      update: {},
      create: {
        messageId,
        userId,
        emoji: normalizedEmoji,
      },
    });

    return this.getMessageWithRelations(messageId);
  }

  async removeReaction(messageId: string, userId: string, emoji: string) {
    const normalizedEmoji = emoji?.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required');
    }
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { room: true },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.ensureActorInRoom(message.roomId, userId);

    await this.prisma.messageReaction.deleteMany({
      where: {
        messageId,
        userId,
        emoji: normalizedEmoji,
      },
    });

    return this.getMessageWithRelations(messageId);
  }

  async getMessageWithRelations(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: true,
        reactions: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return this.formatMessage(message);
  }

  private async ensureActorInRoom(roomId: string, userId: string) {
    const membership = await this.prisma.roomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not part of this room');
    }

    return membership;
  }

  private formatMessage(message: {
    id: string;
    content: string;
    createdAt: Date;
    roomId: string;
    sender: { id: string; username: string; displayColor: string };
    reactions: { id: string; emoji: string; user: { id: string; username: string; displayColor: string } }[];
  }) {
    return {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      roomId: message.roomId,
      sender: {
        id: message.sender.id,
        username: message.sender.username,
        displayColor: message.sender.displayColor,
      },
      reactions: message.reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        user: {
          id: reaction.user.id,
          username: reaction.user.username,
          displayColor: reaction.user.displayColor,
        },
      })),
    };
  }
}


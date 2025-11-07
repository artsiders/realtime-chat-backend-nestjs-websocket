import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

interface SendMessagePayload {
  roomId: string;
  content: string;
}

interface TypingPayload {
  roomId: string;
}

interface ReactionPayload {
  messageId: string;
  roomId: string;
  emoji: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  transports: ['websocket', 'polling'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private typingState = new Map<string, Map<string, NodeJS.Timeout>>();

  constructor(
    private readonly roomsService: RoomsService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const user = await this.authService.validateToken(token);
      const [profile, rooms] = await Promise.all([
        this.usersService.getPublicProfile(user.id),
        this.roomsService.listRoomsForUser(user.id),
      ]);

      client.data.user = { id: user.id };
      client.join(`user:${user.id}`);
      rooms.forEach((room) => {
        client.join(this.getRoomChannel(room.id));
      });

      client.emit('connection:init', { user: profile, rooms });
    } catch (error) {
      client.emit('error', 'Authentication error');
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }

    this.typingState.forEach((users, roomId) => {
      const timeout = users.get(userId);
      if (timeout) {
        clearTimeout(timeout);
        users.delete(userId);
        this.emitTypingUpdate(roomId);
      }
    });
  }

  @SubscribeMessage('rooms:sync')
  async handleRoomsSync(@ConnectedSocket() client: Socket) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }
    const rooms = await this.roomsService.listRoomsForUser(userId);
    rooms.forEach((room) => client.join(this.getRoomChannel(room.id)));
    client.emit('rooms:update', rooms);
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(@ConnectedSocket() client: Socket, @MessageBody() payload: SendMessagePayload) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }

    const message = await this.roomsService.createMessage(payload.roomId, userId, payload.content);
    this.server.to(this.getRoomChannel(payload.roomId)).emit('message:new', message);
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(@ConnectedSocket() client: Socket, @MessageBody() payload: TypingPayload) {
    await this.updateTypingState(client, payload.roomId, true);
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(@ConnectedSocket() client: Socket, @MessageBody() payload: TypingPayload) {
    await this.updateTypingState(client, payload.roomId, false);
  }

  @SubscribeMessage('reaction:add')
  async handleReactionAdd(@ConnectedSocket() client: Socket, @MessageBody() payload: ReactionPayload) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }

    const message = await this.roomsService.addReaction(payload.messageId, userId, payload.emoji);
    this.server.to(this.getRoomChannel(payload.roomId)).emit('message:updated', message);
  }

  @SubscribeMessage('reaction:remove')
  async handleReactionRemove(@ConnectedSocket() client: Socket, @MessageBody() payload: ReactionPayload) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }

    const message = await this.roomsService.removeReaction(payload.messageId, userId, payload.emoji);
    this.server.to(this.getRoomChannel(payload.roomId)).emit('message:updated', message);
  }

  private async updateTypingState(client: Socket, roomId: string, isTyping: boolean) {
    const userId: string | undefined = client.data.user?.id;
    if (!userId) {
      return;
    }

    const users = this.typingState.get(roomId) ?? new Map<string, NodeJS.Timeout>();
    if (!this.typingState.has(roomId)) {
      this.typingState.set(roomId, users);
    }

    const removeUser = () => {
      const timeout = users.get(userId);
      if (timeout) {
        clearTimeout(timeout);
      }
      users.delete(userId);
      this.emitTypingUpdate(roomId);
    };

    if (isTyping) {
      const timeout = setTimeout(removeUser, 5000);
      const existingTimeout = users.get(userId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      users.set(userId, timeout);
    } else {
      removeUser();
      return;
    }

    this.emitTypingUpdate(roomId);
  }

  private async emitTypingUpdate(roomId: string) {
    const users = this.typingState.get(roomId);
    if (!users || users.size === 0) {
      this.server.to(this.getRoomChannel(roomId)).emit('typing:update', { roomId, users: [] });
      return;
    }

    const userIds = Array.from(users.keys());
    const profiles = await Promise.all(userIds.map((id) => this.usersService.getPublicProfile(id)));
    this.server
      .to(this.getRoomChannel(roomId))
      .emit('typing:update', {
        roomId,
        users: profiles.map((profile) => ({
          id: profile.id,
          username: profile.username,
          displayColor: profile.displayColor,
        })),
      });
  }

  private getRoomChannel(roomId: string) {
    return `room:${roomId}`;
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return this.stripBearer(authToken);
    }

    const headerAuth = client.handshake.headers.authorization as string | undefined;
    if (headerAuth) {
      return this.stripBearer(headerAuth);
    }

    const queryToken = typeof client.handshake.query.token === 'string' ? client.handshake.query.token : undefined;
    if (queryToken) {
      return this.stripBearer(queryToken);
    }

    throw new UnauthorizedException('Missing token');
  }

  private stripBearer(value: string): string {
    if (value.startsWith('Bearer ')) {
      return value.slice(7);
    }
    return value;
  }
}

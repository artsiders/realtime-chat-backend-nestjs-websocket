import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateRoomDto } from './dto/create-room.dto';
import { AddMembersDto } from './dto/add-members.dto';

@UseGuards(AuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.roomsService.listRoomsForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateRoomDto) {
    return this.roomsService.createRoom(user.id, dto);
  }

  @Post(':roomId/members')
  addMembers(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddMembersDto,
  ) {
    return this.roomsService.addMembers(roomId, user.id, dto);
  }

  @Get(':roomId/messages')
  getMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50)) : 50;
    return this.roomsService.getMessagesForUser(
      roomId,
      user.id,
      parsedLimit,
      cursor ? { id: cursor } : undefined,
    );
  }
}


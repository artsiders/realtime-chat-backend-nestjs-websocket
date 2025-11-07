import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@WebSocketGateway(3001, {})
export class ChatGateway {
  @SubscribeMessage('message')
  handleMessage(client: Socket, message: string): void {
    console.log(message);
    // eslint-disable-next-line
    client.emit('reply', 'Hello from server');
  }
}

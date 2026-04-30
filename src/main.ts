import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import mongoose from 'mongoose';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  mongoose.set('debug', true);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // 반드시 있어야 @Type 이 작동함
      whitelist: true,
    }),
  );
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: 'http://localhost:3000', // 프론트엔드 주소
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3003);
}

void bootstrap();

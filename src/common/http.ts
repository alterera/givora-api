import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

export function badRequest(code: string, message: string) {
  return new ApiException(code, message, HttpStatus.BAD_REQUEST);
}

export function unauthorized(message = 'Sign in to continue.') {
  return new ApiException('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED);
}

export function forbidden(message = 'You cannot do that.') {
  return new ApiException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
}

export function notFound(message = 'Not found.') {
  return new ApiException('NOT_FOUND', message, HttpStatus.NOT_FOUND);
}

export function conflict(code: string, message: string) {
  return new ApiException(code, message, HttpStatus.CONFLICT);
}

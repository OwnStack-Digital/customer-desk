import { HttpException, HttpStatus } from "@nestjs/common";

/** 422 "validation" error per docs/PLAN.md "Error body". */
export function validationError(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.UNPROCESSABLE_ENTITY);
}

import {
  Body,
  Controller,
  Inject,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import {
  RECEIVE_INBOUND_EMAIL,
  type ReceiveInboundEmail,
  type ReceiveInboundEmailResult,
} from "../../../core/use-cases/receive-inbound-email";
import { validationError } from "./http-error";
import { IngressGuard } from "./ingress.guard";

const attachmentSchema = z.object({
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
});

/**
 * The InboundEmail DTO from docs/ARCHITECTURE.md. MIME parsing stays in the
 * connector; this route only accepts the normalized shape.
 */
const inboundEmailSchema = z.object({
  mailboxId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string().min(1)).optional(),
  from: z.object({
    address: z.string().min(1),
    name: z.string().optional(),
  }),
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  replyTo: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  receivedAt: z.string().min(1),
  sentAt: z.string().optional(),
});

/**
 * `POST /inbound/emails`: stores one normalized inbound email behind the
 * bearer-key guard. New message ⇒ 201; a replay of the same
 * `(mailboxId, sourceMessageId)` ⇒ 200 with the original ids and
 * `duplicate: true`. A mailbox-id mismatch or malformed body is 422.
 */
@Controller("inbound")
@UseGuards(IngressGuard)
export class IngressController {
  private readonly receive: ReceiveInboundEmail;

  constructor(@Inject(RECEIVE_INBOUND_EMAIL) receive: ReceiveInboundEmail) {
    this.receive = receive;
  }

  @Post("emails")
  async postInboundEmail(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReceiveInboundEmailResult> {
    const parsed = inboundEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("The inbound email payload is not valid.");
    }
    const result = await this.receive.run(parsed.data);
    response.status(result.duplicate ? 200 : 201);
    return result;
  }
}
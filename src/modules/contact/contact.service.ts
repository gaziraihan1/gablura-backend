import type { CreateContactMessageInput } from "./contact.validator.js";
import { prisma } from "../../lib/prisma.js";
import { addSendEmailJob } from "../../queue/index.js";

export interface ContactMessageResult {
  id: string;
  createdAt: Date;
}

/**
 * createContactMessage
 *
 * 1. Persists the contact message to the database
 * 2. Fires admin notification email (non-blocking — we await it but swallow errors)
 * 3. Fires user auto-reply email (non-blocking — same pattern)
 *
 * Email failures are logged but do NOT cause the request to fail — the
 * message is already saved to the DB and the user should get a success response.
 */
export async function createContactMessage(
  data: CreateContactMessageInput,
  ip: string,
  userAgent: string
): Promise<ContactMessageResult> {
  // ── 1. Persist ────────────────────────────────────────────────────────────
  const message = await prisma.contactMessage.create({
    data: {
      name: data.name,
      email: data.email,
      subject: data.subject,
      category: data.category,
      message: data.message,
      ipAddress: ip,
      userAgent: userAgent,
      status: "UNREAD",
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  // ── 2. Admin email ────────────────────────────────────────────────────────
  addSendEmailJob({
    type: "admin-contact-notification",
    to: "",
    data: { contactData: data, messageId: message.id, ip },
  }).catch((err) => {
    console.error("[contact.service] Failed to queue admin email:", err);
  });

  // ── 3. User auto-reply ────────────────────────────────────────────────────
  addSendEmailJob({
    type: "user-auto-reply",
    to: data.email,
    data: { contactData: data },
  }).catch((err) => {
    console.error("[contact.service] Failed to queue user auto-reply:", err);
  });

  return message;
}

/**
 * getContactMessages — admin use only
 * Returns paginated list of contact messages, newest first.
 */
export async function getContactMessages(options: {
  page: number;
  limit: number;
  status?: string;
  category?: string;
}) {
  const { page, limit, status, category } = options;
  const skip = (page - 1) * limit;

  const where = {
    ...(status ? { status: status as any } : {}),
    ...(category ? { category: category as any } : {}),
  };

  const [messages, total] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        category: true,
        status: true,
        createdAt: true,
        message: true,
      },
    }),
    prisma.contactMessage.count({ where }),
  ]);

  return {
    messages,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

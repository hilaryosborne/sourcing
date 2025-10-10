import { nanoid } from "nanoid";
import z, { email, object, string } from "zod";
import event from "./event";

enum UserConstEventTopic {
  UserEventEmailV1 = "user.email.v1",
}

const CommonModelEmailV1 = object({
  uid: string().optional().default(nanoid),
  address: email().min(5).default("user@example.com"),
  type: z.enum(["personal", "work", "other"]).optional().default("personal"),
  verified: z.enum(["pending", "verified", "unverified"]).optional().default("pending"),
});

CommonModelEmailV1.default({ uid: nanoid(), type: "personal", address: "", verified: "pending" });

const UserModelEventEmailV1 = z.object({
  primary: z.enum(["yes", "no"]).default("no"),
  email: CommonModelEmailV1,
});

describe("event", () => {
  it("can create a event with a payload", () => {
    const UserEventEmailV1 = event(UserConstEventTopic.UserEventEmailV1, UserModelEventEmailV1);
    const data = UserEventEmailV1.create({
      primary: "yes",
      email: { address: "hello@example.com" },
    });
    console.log(data.toObject());
    expect(true).toBe(true);
  });
});

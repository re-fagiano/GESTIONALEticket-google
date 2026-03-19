import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "davidealessandro@gmail.com" },
    update: {
      passwordHash: hashedPassword,
      role: "ADMIN",
    },
    create: {
      email: "davidealessandro@gmail.com",
      passwordHash: hashedPassword,
      role: "ADMIN",
      operatorCode: "OP-ADMIN01",
    },
  });

  console.log("Admin creato");
}

main()
  .catch((error) => {
    console.error("Errore seed admin", error);
    globalThis.process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

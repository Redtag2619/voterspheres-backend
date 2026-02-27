export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  subscriptionStatus: "active" | "inactive";
  tenantId: string;
}

export const users: User[] = [];

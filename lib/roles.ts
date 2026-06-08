import type { AppRole } from "@/lib/auth";

export function canMutate(role: AppRole) {
  return role === "admin" || role === "trainer";
}

export function isAdmin(role: AppRole) {
  return role === "admin";
}

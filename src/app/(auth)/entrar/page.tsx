import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default function SignInPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-1 text-sm text-muted">Aceda ao seu escritório.</p>
      <div className="mt-8">
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
      <p className="mt-8 text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link href="/registar" className="font-medium text-ink underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </>
  );
}

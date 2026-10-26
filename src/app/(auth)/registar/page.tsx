import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-1 text-sm text-muted">
        Depois de confirmar o email, cria o seu escritório ou aceita um convite da sua equipa.
      </p>
      <div className="mt-8">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
      <p className="mt-8 text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium text-ink underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </>
  );
}

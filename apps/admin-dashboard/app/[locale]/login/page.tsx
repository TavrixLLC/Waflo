import { AdminLogin } from "../../../components/admin-login";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminLogin locale={locale === "ar" ? "ar" : "en"} />;
}

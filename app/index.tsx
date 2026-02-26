// app/index.tsx  →  / 경로는 /login 으로 redirect
import { Redirect } from 'expo-router';
export default function Index() {
  return <Redirect href="/login" />;
}

import { notFound } from 'next/navigation';
import InternalTransmitter from './transmitter-client';

export default function InternalTransmitterPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <InternalTransmitter />;
}

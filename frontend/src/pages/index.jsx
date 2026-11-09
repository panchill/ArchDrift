import React from 'react';
import Layout from '@theme/Layout';
import { CalmDiagram } from '../calm/CalmDiagram';
import architecture from '../../../examples/shop/architecture.json';

export default function Home() {
  return (
    <Layout title="Shop architecture">
      <main className="container margin-vert--lg">
        <h1>Shop architecture</h1>
        <CalmDiagram data={architecture} />
      </main>
    </Layout>
  );
}

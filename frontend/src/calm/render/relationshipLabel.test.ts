import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relationshipLabel } from './relationshipLabel.ts';

test('http call shows method and route', () => {
  assert.equal(relationshipLabel({ protocol: 'HTTP', metadata: { interaction: 'http_call', method: 'GET', route: '/orders/{id}' } }), 'GET /orders/{id}');
});

test('db query lists operations', () => {
  assert.equal(relationshipLabel({ protocol: 'JDBC', metadata: { interaction: 'db_query', match: { dbOperations: ['SELECT'] } } }), 'JDBC SELECT');
  assert.equal(relationshipLabel({ protocol: 'JDBC', metadata: { interaction: 'db_query' } }), 'JDBC');
});

test('consume shows worker, publish shows interaction', () => {
  assert.equal(relationshipLabel({ metadata: { interaction: 'consume', worker: 'new-order-consumer' } }), 'consume · new-order-consumer');
  assert.equal(relationshipLabel({ metadata: { interaction: 'publish' } }), 'publish');
});

test('deny is prefixed', () => {
  assert.equal(relationshipLabel({ protocol: 'JDBC', metadata: { action: 'deny', interaction: 'db_query' } }), 'deny · JDBC');
});

test('empty relationship gives empty label', () => {
  assert.equal(relationshipLabel({}), '');
});

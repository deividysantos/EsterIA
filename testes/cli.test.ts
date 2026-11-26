import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ErroUso, parsearArgs } from '../src/cli/painel.ts';
import { obterCaminhoBanco, obterDadosDir, obterPorta } from '../src/server/config.ts';

describe('painel: argumentos', () => {
  it('ajuda e versão', () => {
    assert.deepEqual(parsearArgs([]), { tipo: 'ajuda' });
    assert.deepEqual(parsearArgs(['--help']), { tipo: 'ajuda' });
    assert.deepEqual(parsearArgs(['--version']), { tipo: 'versao' });
  });

  it('servidor com opções nos dois formatos', () => {
    assert.deepEqual(parsearArgs(['servidor']), { tipo: 'servidor' });
    const r = parsearArgs(['servidor', '--porta', '4799', '--host=localhost', '--banco', 'x.db']);
    assert.deepEqual(r, { tipo: 'servidor', porta: 4799, host: 'localhost', banco: path.resolve('x.db') });
  });

  it('erros de uso', () => {
    assert.throws(() => parsearArgs(['voar']), ErroUso);
    assert.throws(() => parsearArgs(['servidor', '--porta']), /Valor ausente/);
    assert.throws(() => parsearArgs(['servidor', '--porta', 'abc']), /Porta inválida/);
    assert.throws(() => parsearArgs(['servidor', '--xyz']), /Opção desconhecida/);
  });
});

describe('config de ambiente', () => {
  it('usa padrões e respeita variáveis', () => {
    const home = path.resolve('/home/teste');
    assert.equal(obterDadosDir({ USERPROFILE: home }), path.join(home, '.painel-agentes'));
    assert.equal(obterCaminhoBanco({ USERPROFILE: home }), path.join(home, '.painel-agentes', 'painel.db'));
    assert.equal(obterCaminhoBanco({ PAINEL_DADOS_DIR: '/d' }), path.join(path.resolve('/d'), 'painel.db'));
    assert.equal(obterCaminhoBanco({ PAINEL_BANCO: '/x/y.db' }), path.resolve('/x/y.db'));
    assert.equal(obterPorta({}), 4710);
    assert.equal(obterPorta({ PAINEL_PORTA: ' 4799 ' }), 4799);
    assert.throws(() => obterPorta({ PAINEL_PORTA: '70000' }), /Porta inválida/);
  });
});

const asunto = process.argv[2] ?? '';
const valido = /^(feat|fix|refactor|docs|test|chore|perf)(\([a-z0-9-]+\))?: .+/.test(asunto);
console.log(valido ? 'VALIDO' : 'INVALIDO', '| longitud:', asunto.length);
process.exit(valido && asunto.length <= 72 ? 0 : 1);

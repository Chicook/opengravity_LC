---
name: commit-convencional
description: >-
  Use this skill when the user asks to commit, to write a commit message, or to
  prepare changes for review. Applies the Conventional Commits format this repo uses.
---

# Commits convencionales

Todos los mensajes de commit de este repositorio siguen el formato
`tipo(alcance): descripción`.

## Pasos

1. Mira qué ha cambiado:
   `git status --short` y `git diff --stat`.
2. Elige el tipo: `feat`, `fix`, `refactor`, `docs`, `test`, `chore` o `perf`.
3. Escribe el asunto en imperativo, en minúscula y sin punto final.
4. Si el cambio necesita explicación, añade un cuerpo separado por una línea en blanco.

## Verificación

Antes de dar el commit por bueno, comprueba que:

- el asunto no pasa de 72 caracteres,
- el tipo está en la lista de arriba,
- el alcance coincide con el módulo que tocaste.

Puedes validar el formato con `node scripts/valida-asunto.mjs "<asunto>"`.

/**
 * NestJS CRUD generator (HELIX-104) — the worked "generator per stack" exemplar.
 *
 * Given a resource name it returns the module / controller / service / DTO files
 * for an idiomatic NestJS CRUD resource (an in-memory store, to stay dependency-
 * free). It's a pure function from name → {@link ScaffoldFile}[]; the caller
 * writes them with {@link applyScaffold}.
 */
import { resourceNames, ResourceNames, ScaffoldFile } from '../scaffold';

/** Generate a NestJS CRUD resource (module, controller, service, create/update DTOs). */
export function nestCrudResource(name: string): ScaffoldFile[] {
  const n = resourceNames(name);
  const dir = `src/${n.kebab}`;
  return [
    { path: `${dir}/${n.kebab}.module.ts`, content: moduleFile(n) },
    { path: `${dir}/${n.kebab}.controller.ts`, content: controllerFile(n) },
    { path: `${dir}/${n.kebab}.service.ts`, content: serviceFile(n) },
    { path: `${dir}/dto/create-${n.kebab}.dto.ts`, content: createDtoFile(n) },
    { path: `${dir}/dto/update-${n.kebab}.dto.ts`, content: updateDtoFile(n) },
  ];
}

function moduleFile(n: ResourceNames): string {
  return `import { Module } from '@nestjs/common';
import { ${n.pascal}Controller } from './${n.kebab}.controller';
import { ${n.pascal}Service } from './${n.kebab}.service';

@Module({
  controllers: [${n.pascal}Controller],
  providers: [${n.pascal}Service],
})
export class ${n.pascal}Module {}
`;
}

function controllerFile(n: ResourceNames): string {
  const svc = `${n.camel}Service`;
  return `import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Create${n.pascal}Dto } from './dto/create-${n.kebab}.dto';
import { Update${n.pascal}Dto } from './dto/update-${n.kebab}.dto';
import { ${n.pascal}Service } from './${n.kebab}.service';

@Controller('${n.pluralKebab}')
export class ${n.pascal}Controller {
  constructor(private readonly ${svc}: ${n.pascal}Service) {}

  @Post()
  create(@Body() dto: Create${n.pascal}Dto) {
    return this.${svc}.create(dto);
  }

  @Get()
  findAll() {
    return this.${svc}.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.${svc}.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Update${n.pascal}Dto) {
    return this.${svc}.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.${svc}.remove(id);
  }
}
`;
}

function serviceFile(n: ResourceNames): string {
  return `import { Injectable, NotFoundException } from '@nestjs/common';
import { Create${n.pascal}Dto } from './dto/create-${n.kebab}.dto';
import { Update${n.pascal}Dto } from './dto/update-${n.kebab}.dto';

export interface ${n.pascal} {
  id: string;
  name: string;
}

@Injectable()
export class ${n.pascal}Service {
  private readonly items = new Map<string, ${n.pascal}>();
  private seq = 0;

  create(dto: Create${n.pascal}Dto): ${n.pascal} {
    const id = String(++this.seq);
    const item: ${n.pascal} = { id, name: dto.name };
    this.items.set(id, item);
    return item;
  }

  findAll(): ${n.pascal}[] {
    return [...this.items.values()];
  }

  findOne(id: string): ${n.pascal} {
    const item = this.items.get(id);
    if (!item) {
      throw new NotFoundException(\`${n.pascal} \${id} not found\`);
    }
    return item;
  }

  update(id: string, dto: Update${n.pascal}Dto): ${n.pascal} {
    const item = this.findOne(id);
    const updated: ${n.pascal} = { ...item, ...dto };
    this.items.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.items.delete(id)) {
      throw new NotFoundException(\`${n.pascal} \${id} not found\`);
    }
  }
}
`;
}

function createDtoFile(n: ResourceNames): string {
  return `export class Create${n.pascal}Dto {
  name!: string;
}
`;
}

function updateDtoFile(n: ResourceNames): string {
  return `import { PartialType } from '@nestjs/mapped-types';
import { Create${n.pascal}Dto } from './create-${n.kebab}.dto';

export class Update${n.pascal}Dto extends PartialType(Create${n.pascal}Dto) {}
`;
}

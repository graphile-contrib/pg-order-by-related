drop schema if exists p cascade;

create schema p;

create table p.parent (
  id serial primary key,
  name text not null
);

create table p.forward (
  id serial primary key,
  name text not null
);

create table p.forward_compound (
  forward_compound_1 int,
  forward_compound_2 int,
  name text,
  primary key (forward_compound_1, forward_compound_2)
);

create table p.foo (
  id serial primary key,
  name text,
  parent_id int references p.parent (id),
  forward_id int unique references p.forward (id),
  forward_compound_1 int,
  forward_compound_2 int,
  backward_compound_1 int,
  backward_compound_2 int,
  unique (backward_compound_1, backward_compound_2),
  foreign key (forward_compound_1, forward_compound_2) references p.forward_compound (forward_compound_1, forward_compound_2)
);

create table p.backward (
  id serial primary key,
  name text not null,
  foo_id int unique references p.foo (id)
);

create table p.backward_compound (
  backward_compound_1 int,
  backward_compound_2 int,
  name text,
  primary key (backward_compound_1, backward_compound_2),
  foreign key (backward_compound_1, backward_compound_2) references p.foo (backward_compound_1, backward_compound_2)
);

create table p.child (
  id serial primary key,
  name text not null,
  foo_id int references p.foo (id)
);

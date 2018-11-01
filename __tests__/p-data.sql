insert into p.parent(id, name) values
  (1, 'parent1'),
  (2, 'parent2');

insert into p.forward(id, name) values
  (1, 'forward1'),
  (2, 'forward2'),
  (3, 'forward3'),
  (4, 'forward4');

insert into p.forward_compound(forward_compound_1, forward_compound_2, name) values
  (1, 1, 'forwardCompound11'),
  (1, 2, 'forwardCompound12'),
  (2, 1, 'forwardCompound21'),
  (2, 2, 'forwardCompound22');

insert into p.foo (id, name, parent_id, forward_id, forward_compound_1, forward_compound_2, backward_compound_1, backward_compound_2) values
  (1, 'TEST', 1, 1, 1, 1, 1, 1),
  (2, 'Test', 1, 2, 1, 2, 1, 2),
  (3, 'tEST', 2, 3, 2, 1, 2, 1),
  (4, 'test', 2, 4, 2, 2, 2, 2),
  (5, null, null, null, null, null, null, null);

insert into p.backward(id, name, foo_id) values
  (1, 'backward1', 1),
  (2, 'backward2', 2),
  (3, 'backward3', 3),
  (4, 'backward4', 4);

insert into p.backward_compound(backward_compound_1, backward_compound_2, name) values
  (1, 1, 'backwardCompound11'),
  (1, 2, 'backwardCompound12'),
  (2, 1, 'backwardCompound21'),
  (2, 2, 'backwardCompound22');

insert into p.child(id, name, foo_id) values
  (1, 'child1', 1),
  (2, 'child2', 1),
  (3, 'child3', 2),
  (4, 'child4', 2);
# Do we really need an ORM?

## Content

- [Motivation](#motivation)
- [The perfect ORM is an illusion](#the-perfect-orm-is-an-illusion)
- [The benefits and drawbacks of using an ORM](#the-benefits-and-drawbacks-of-using-an-orm)
- [My experience](#my-experience)
- [My recommendation](#my-recommendation)

## **Motivation**

Nowadays, using an ORM (Object-Relational Mapping) is a low-hanging fruit because there are plenty of such implementations available for modern programming languages and a variety of databases. But is this healthy or always necessary for the application?

I often face situations during [my workshops](https://ionutbalosin.com/training), [courses](https://ionutbalosin.com/training), and interviews when I see people implicitly considering using an ORM as a must-have approach every time a database is involved. This is primarily caused by the fact that the majority of developers do not like writing SQL nor handling the mappings between the database result sets and the object models.

In this article, I will try to explain why this approach is toxic, when and how you should use an ORM, and what are the consequences if not properly rationalized.

## **The perfect ORM is an illusion**

Assuming that an ORM will prevent you from doing the boring stuff (e.g. writing SQL) so you could focus on different parts of the applications is in general a wrong assumption. The primary purpose of an ORM is to map the database result sets to object graphs. In addition, an ORM also tracks object changes and synchronizes those changes back to the database. The SQL part must and should stay in the total control of developers. I can argue that every software engineer using a relational database as part of the backend application should understand how a relational database works, the standard SQL, and the flavors in regards to that database. Using an ORM does not mean that you do not have to care anymore about how the application interacts with the database so you can treat it as a neglectable piece in your architecture. On the contrary, you just added another layer of abstraction and complexity, the ORM itself.

Mapping to a relational database and generating the underlying SQL involves boiler-plate code. Generating the most efficient SQL is bound to the way the object model is declared and how the ORM is instructed to do so (i.e. additional metadata at the code level). It is fairly easy to start with an ORM and create hello world, relatively simple applications. Nevertheless, for complex beasts (i.e. production-ready systems) you need to master it and this is not an easy task, it requires a steep learning curve.

Ignoring these aspects will hit you at some point when you have to debug and understand the generated queries behind the ORM and why they are inefficiently slow (e.g. over-fetch columns, N+1 queries, unindexed queries, records saved multiple times, etc.). Sometimes the fix might require only adding or changing a few specific ORM annotations, or writing a tailor-made SQL. In other cases, you might end up altering the object model for the sake of the ORM because the object-oriented model and the database relationship model are two different things (not directly interchangeable).

## **The benefits and drawbacks of using an ORM**

Using an ORM is not fundamentally a bad idea. The intention of this post is not to criticize or blame the ORMs, but to make people think extremely carefully before including an ORM in their applications. 

There are advantages that an ORM might bring (if properly used):

- caching
- pessimistic/optimistic locking
- increased database (leaky) abstractions
- mapping the database result sets to object graphs, tracking object changes, synchronizing the changes to the database
- optimized generated queries
- optimized database connection management

As for the disadvantages, they could be summarized as follows:

- steep learning curve
- an additional (not neglectable) layer of abstraction and complexity
- complex or dynamic queries are, in general, not properly handled and further extensions, on top of the ORM, are needed
- implements less standard SQL features that a database conforms to (i.e. if a database conforms to almost all SQL standard features plus adds some specifics, an ORM only uses a subset of these)
- debugging performance queries is challenging

## **My experience**

Early in my career as a software engineer, I used some JPA/JDO implementations (e.g. Hibernate, DataNucleus). This experience taught me in general to be very cautious with the ORMs, as they add significant complexity. Without a proper understanding of the ORM (and this is not an easy task) it leads, in general, to more troubles that benefit. Then I started to become skeptical and during the last ten years, I never used such in any production system I worked on. I am very comfortable with this choice since I prefer to invest the time in understanding how a database works, how to write the proper SQL by myself instead of focusing on learning how to master an ORM framework. Besides this, I do not remember having any issues or discomfort with this approach. On the contrary, it is much easier to debug and fix the production issues because you are in control of the SQL and the entire database model is familiar to you (since you explicitly defined it).

## **My recommendation**

**Step 1.** Invest the time in learning how a relational database works and how to write SQL in general and in particular the SQL flavors needed for the specific database used by the backend application. This is an extremely valuable skillset that you need either way.

SQL stays pretty much constant over the years, the first standard was published in 1986 (e.g. SQL-86) and it gets updated once every few years (sometimes without even significant features). SQL is a transferable asset across programming languages and frameworks, in comparison to an ORM that is programming language-specific and might vanish in a few years.

**Step 2.** Start your project pragmatically, by writing your SQL and being in control of your schema changes. Solutions like Spring JdbcTemplate and a library to version database schema changes (e.g. Liquibase, FlywayDB, etc.) are perfect fits.

**Step 3.** Optionally, check if using a lightweight SQL mapper framework might be useful (e.g. QueryDSL, jOOQ, TypeSQL, SimpleFlatMapper, etc.). In my opinion, this is a nice extension to the previous point

**Step 4.** Only as a last resort solution, consider using an ORM (e.g. Hibernate, Apache Cayenne, Oracle TopLink, DataNucleus, etc.). If an ORM fits your needs, your culture, and your skillset, why not use it? But please make sure first you read the manual, otherwise, you will shoot yourself in the foot quite soon.

Starting directly with an ORM and neglecting the first three approaches (in that specific order) is not something that I would ever recommend.

### **Should the decision of using an ORM be bound to the architectural style?**

Not at all, in my opinion. There might be other forces towards using an ORM (e.g. company strategies, architects or developers bias) but not the architectural style itself.

Nevertheless, for an architectural style where the services are smaller, modular, and independently deployable (i.e. microservices) using an ORM adds unnecessary complexity to the service since in general such services have a relatively limited object data model, much easier to manage otherwise.

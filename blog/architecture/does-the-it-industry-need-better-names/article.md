# Does the IT Industry Need Better Names?

## Content

- [Takeaways](#takeaways)
- [Why this matters – what makes naming important](#why-this-matters-what-makes-naming-important)
- [Architecture – a parallelism between IT and construction](#architecture-a-parallelism-between-it-and-construction)
- [Non-functional requirements or quality attributes](#non-functional-requirements-or-quality-attributes)
- [Quality Assurance (QA) or Quality Control (QC)](#quality-assurance-qa-or-quality-control-qc)
- [Layers – a comparison between software and hardware](#layers-a-comparison-between-software-and-hardware)
- [Microservices](#microservices)
- [Component](#component)
- [Weak Generational Hypothesis](#weak-generational-hypothesis)
- [Software application names](#software-application-names)
- [How to deal and improve bad terminology in your organization](#how-to-deal-and-improve-bad-terminology-in-your-organization)
- [Terminology across distributed teams](#terminology-across-distributed-teams)
- [Final conclusions](#final-conclusions)

> According to the licensing policy, I would like to mention this article was originally published on [InfoQ](https://www.infoq.com/articles/IT-industry-better-namings).

## **Takeaways**

1. Why having proper names is important
2. Examples of poor naming within the IT industry
3. Side effects caused by poor or leaky names
4. How to deal with poor naming in teams and companies
5. How to prevent bad terminology happening in the future

    After reading plenty of articles, books and listening to conference speakers, I often ask myself if we are always using appropriate or consistent terms in IT industry. We have borrowed some of them from other domains, which is a fairly good approach, but sometimes we distort their meanings or use terms in an inconsistent way, within IT and also in comparison to other disciplines.

In this article I will share some of these leaky terminologies with examples and express my opinion why this matters and how to deal with inconsistencies. I will provide suggestions on how to improve this situation inside organizations and across them.

## **Why this matters – what makes naming important**

   During recent years, the IT industry has started to become more and more driven by trends and fashions (e.g. methodologies, frameworks); the number of IT conferences has exponentially increased and we have started to express our identity through software more than ever. In this context of the technology boost, it is fundamental to use proper names, to rely on accurate terminologies, and to have an organic and sustainable growth. Names reflect the quality and the maturity of the industry, and improper usages of them brings misunderstandings, confusions and sometimes causes false expectations.

## **Architecture – a parallelism between IT and construction**

   Before explaining what the word architecture means in software, I will start by describing two terms from construction, a more mature industry in comparison to software: *structural engineer* and *architectural engineer*. A s*tructural engineer* needs to understand and calculate the stability, strength and rigidity of a building to make sure it holds up to gravity, wind and other forces. He is responsible for the structural integrity and consistency of the construction. On the other side, an *architectural engineer* is responsible for essential building features like lighting, acoustics, ventilation, heating, plumbing, emergency exits, fire prevention and security systems. They need to work closely together to make the building stand up.

Now, let’s get back to software industry. What does the architecture word mean in this context?

One definition from ANSI/IEEE Std 1471-2000 says architecture is “*the fundamental organization of a system embodied in its components, their relationships to each other, and to the environment, and the principles guiding its design and evolution*”. Another definition, which is the shortest I found, belongs to Ralph Johnson, later embraced by Martin Fowler, and defines the architecture as “*the important stuff (whatever that is)*”.

Based on the analogy with construction, the software architect is more like a structural engineer, rather than an architectural engineer.

Maybe it would have been nice to keep consistency and obey the same terms as in the construction field, but probably the phonetics of the word “architecture” sound more attractive for software folks.

However, some people have difficulty in defining it properly. During my software architecture course I noticed that even experienced people have different understandings about its meaning  and the responsibilities of a software architect. As a consequence, there are teams where the software architect role is mixed with technical leader attributes; in such a case the former (e.g. software architect) does not even exist! The technical leader borrows the ownership across designing the structure, the boundaries, the communication mechanisms and the APIs for the entire application with external systems, all of these things being more on the architectural side. These mixed roles blur technical skill segregation and might prevent projects from delegating proper responsibilities to appropriate people inside teams. As an additional consequence, it can also impact the way we become educated and evolve in our careers.

## **Non-functional requirements or quality attributes**

Oftentimes, business requirements are drilled down in functional and non-functional specifications. In this context, the non-functional requirements refer to quality attributes such as performance, availability, scalability, security, usability, etc.

But let’s try to better understand what’s behind the non-functional terminology guided by two approaches: the first one is to search the word in the dictionary and the second one is to show the technical implications with regards to their achievability.

According to the dictionary, the *“non”* word means “*not, absence of, unimportant, worthless*”. Based on this definition, the question which arises is: how can we name something non-functional and still having an impact on the architecture, since by semantics it is “worthless”? Why shouldn’t we drop or put aside these requirements? Hence, the first inconsistency.

Following with the second approach, all non-functional requirements (e.g. security, usability) are implemented through functions (e.g. security via encryption, usability via a wizard), so they rely on concrete functions. It leads to the second question: how can we name something as being non-functional when it is implemented through functions?

Discussing non functional requirements with non-technical stakeholders can cause difficult situations when referring to quality attributes as manageability, maintainability, accessibility and usability of the product due to the confusions that appear (e.g. things related to maintainability are addressed through manageability). This is also a a trap for the architects, and to avoid it they must go into further clarification details in terms of meanings and implications, because designing the product by achieving one quality attribute (e.g. maintainability) might imply architectural trade-offs in fulfilling the other one (e.g. manageability). Confusions might appear also in case of accessibility and usability of the product, which are often interchanged and misused.

## **Quality Assurance (QA) or Quality Control (QC)**

In almost every software team there are members titled as quality engineers (QA). Their role is mainly to understand the specifications and based on them define a set of test cases (e.g. functional, acceptance, integration, etc) in order to validate the product and to detect possible flaws. If we search what QA and QC mean by looking at the definitions, we see that a QC is “*an aggregate of activities (such as design analysis and inspection for defects) designed to ensure adequate quality especially in manufactured products*”, whereas the QA is “*a program for the systematic monitoring and evaluation of the various aspects of a project, service, or facility to ensure that standards of quality are being met*”, as per merriam-webster.com definitions.

Based on these definitions, people embedded in software development teams in charge of defining test cases and validating the product are more QC engineers. This might cause problems. I encountered confusions due to recruiters who were searching for people acting as QAs in their organizations and offering jobs as QCs, or vice versa. A friend was recently in this situation- she was invited to discuss a QC role position  (e.g. which involves defining test cases and validating the product) but in reality she had qualifications (e.g. ISO certifications) specific to a QA (e.g. in charge of monitoring and ensuring the processes across company are according to ISO standards). These two roles are disjunct; they may be complementary in a way but in all cases the knowledge and set of skills are different.

Using QA and QC names improperly also leads to mixed, cluttered or not well-understood responsibilities within the teams.

## **Layers – a comparison between software and hardware**

The term layers was initially introduced in networking, where layers were designed to contribute to the same final purpose, but at a different level of abstraction: establishing and supporting a proper communication across different nodes over network. For example, based on the OSI stack, there are seven layers (e.g. physical, datalink, network, transport, session, presentation and application), every layer contributing to the same purpose. The abstraction raises proportionally to the level of the layer (e.g. the *send()* method belonging to the application layer could be based on multiple less abstract and specific APIs).

In software, layers are not complementary at any level of abstraction, as it is in networking. For example, the data access layer (e.g. in charge of handling database connections and CRUD operations) has a specific purpose. Other layers, like a business layer, are not acting at a higher or lower level of abstraction in comparison to the data access layer. They are mainly designed to segregated functionalities inside each layer, rather than working complementary in an abstract way. An interesting presentation on this subject was given by Ralf Westphal: “[Let software design come to life using software cells](https://www.youtube.com/watch?v=2Kt6dLeHVus)”.

## **Microservices**

During recent years, the term microservices is being used intensively and a lot of architectures adopted this style. It emerged from Service Oriented Architecture (SOA) due to some issues applications faced by following this architectural pattern. I like the quote from Jonas Bonér which state that “*microservices are actually just SOA dressed up in new clothes*”. But what does the term microservices really mean? By following the dictionary definition, it might refer to an extremely small service, or a ‘few quantity’ of services. In reality, it is a service implemented with a single purpose, self-contained and independent of other instances and services. Nowadays there are applications with hundreds or even thousands of services, which becomes very difficult to manage. A possible cause is that people understood implementing microservices in different ways. There was not a common, robust definition nor good practices around them. Since the definition is leaky, it has nothing to do with the prefix “micro” attached to the word “services”. We definitely should have come up with a better term to reflect the need. Being eager to bypass the SOA issues, it was prematurely embraced with too much enthusiasm at a higher scale in the industry. A good presentation describing the issues faced in case the number of microservices explodes is described in the [What Comes after Microservices?](https://www.infoq.com/presentations/microservices-future)  talk from a Chief Systems Architect at Uber. I personally think that with proper definitions and robust and standardized guidelines, from an architectural standpoint, we would have designed better microservices architectures. But learning from our mistakes it is not a bad thing, since the mistakes are not irreversible and we don’t have to repeat them in the future.

## **Component**

Component (like microservices) is another term that has caused problems in terms of definition. There are a lot of misunderstandings and people sometimes replace the term component with a package or even with an object. The views from software architecture contain components, but what is the actual representation or analogy of these components in the code? Is there any entity at the code level called component? Of course not, hence the ambiguities. I like Martin Fowler’s definition which says a “*component is a unit of software that is independently replaceable and upgradeable*”. This definition has no reference neither to a package, nor to a class, but to the state and the properties of the component itself.

A major impact of this misunderstanding arrises when, based on architectural design (e.g. made up using component diagrams), developers need to follow up during implementation. If the term ‘component’ is not precisely specified (e.g. how it maps to the code), the implementation becomes leaky and might suffer flaws from the initial design (e.g. ending up with tight coupling and low cohesion components, poorly defined APIs, etc). From a software architect perspective, when I am in a discussion with other technical stakeholders and we use the term component, I rather prefer to define it from the very beginning: *“what does a component mean in our context? How  can we clearly identify a component in our architecture?”*, as otherwise we might refer to different things.

## **Weak Generational Hypothesis**

Inside Java Virtual Machine the memory layout and the garbage collector heuristics are based on **Weak Generational Hypothesis** which states that:

- most objects soon become unreachable
- references from old objects to young objects only exist in small numbers

But what does the **hypothesis** word means? From a science perspective it refers to an idea or an explanation that needs to be tested through study and experimentation. Outside the scientific world, the hypothesis word is used more loosely and it often involves guessing or relying on an assumption, since it can never be demonstrated (e.g. a programming language is not science … yet). Probably in this context it would have been more adequate to call them suppositions or preconditions instead of **hypothesis,** which probably won’t influence the way software developers use and implement this concept, but at least using the correct term would have been a better approach.

## **Software application names**

There are software applications which might bring confusions depending on their name. For example, there is an application called Protocol Buffers which by specs is a “*language-neutral, platform-neutral, extensible mechanism for serializing structured data*”. The term ‘protocol’ is confusing here, since in IT (e.g. networking) it normally refers to the mechanisms for devices to discover, identify and make connections with each other, as well as a set of rules defining how data is packaged during communication. Based on the above, we can easily spot that Protocol Buffers is not a ‘protocol’ in the sense of networking, but just a way of dealing with structured data at the application layer. Probably it would have been better to follow up on industry naming standards in order to avoid confusions.

## **How to deal and improve bad terminology in your organization**

   To overcome all these inconsistencies, we probably need to search and read more about the basics (e.g. use dictionaries), before associating the terms. Starting from our organizations, within teams, we can create semantic guidelines/dictionaries (e.g. by definitions and examples) and share them with all parties, a sort of technology radar from a terminology standpoint, which can offer a more correct and better understanding. I have created one inside my project which is used by all stakeholders I interact with and eases the way we communicate with each other. For example, it improves the interaction between Business Analysts and developers, especially when defining business specifications because the analysts might add references to these guidelines (e.g. inside a User Story description). Also during architectural presentations and inside technical documentation, we always make references to this radar as a ground source of common sense in our environment.  It is important to have a baseline, a common reference when discussing together (e.g. technical and non-technical stakeholders) to ease the communication, and at the end it speeds up the entire development process.

Also, apart from clarifying terminology by definitions and examples, it is important to use  SMART objectives (e.g. specific, measurable, achievable, realistic, time-related) to avoid fuzzy situations. For example, just having a proper definition of what **microservice** means inside your project/organization is good, but probably is not enough. It would be better to detail the context; in which case a microservice would be a better fit, how to measure if the service really fulfills just one single purpose, how realistic it is to have created one more microservice instead of extending an existing one, how to test this microservice in isolation and in integration with others, what would be the impact on the entire architecture if a new service is added, how costly would it be to develop and maintain this service, etc.

Under technical circumstances, try to capture and specify everything as being quantitative, measurable, testable and falsifiable. Otherwise it is difficult to develop, validate and demonstrate it.

## **Terminology across** **distributed teams**

   Working in distributed teams is a bit more challenging, but in my opinion the tactiques to deal with terminology should be the same. Eric Evans and later Martin Fowler referred to  ‘*ubiquitous language*’ term (agnostic of a specific domain) as a way of interacting with stakeholders having different background and coming from different cultures. I would say in case of dealing with leaky terminologies, we could apply the same technique; we need to define the set of terms (with proper definitions, examples, etc) that make sense in our  environment (economical, political, cultural and technological) and share it across various teams. It is going to be used as an internal glossary, or as a *bounded language*, a language which is not agnostic but has proper meaning to our business.

## **Final conclusions**

   Names reflect education and influence the way we perceive things and develop ourselves. Having proper names leads to an organic industry evolution; people will stop using leaky terms and the quality and level of standardization inside IT will increase.

---

**Tags**: Software Architecture, IT Industry, Naming, Software Engineering, Microservices, Components, Quality Assurance, Software Terminology, Industry Terms

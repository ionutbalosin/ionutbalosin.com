# When do we need an architect

## Content

- [Key takeaways](#key-takeaways)
- [Type of projects that might need an architect](#type-of-projects-that-might-need-an-architect)
- [Type of projects that might not necessarily need an architect](#type-of-projects-that-might-not-necessarily-need-an-architect)

## **Key takeaways**

- the methodology, whatever that is (e.g. SCRUM, SAFE, etc) should not impose the necessity of having an architect in the team, but rather the real project needs.
- in the case of greenfield projects, for projects with a lot of external dependencies, projects under intensive development that involve architectural decisions, technology or framework elicitation, the role of the architect becomes fundamental.
- projects where all business problems were rationalized, projects where technical decisions are externally governed, projects where no major developments are foreseen or projects under maintenance do not necessarily need an architect.

The current article tries to identify different types of projects which might potentially need an architect. While there are a lot of resources on the internet trying to provide answers to questions like WHY and WHO needs an architect, this is supposed to complement them by giving an interpretation to the question: “when do we need an architect”. To be more specific, I refer to the role of an IT architect and I am going to provide my definition which fits within the context of the current article. In that regard, in my understanding, an IT architect focuses on solution-level decisions and analysis for a business portfolio, application, system, infrastructure or the entire enterprise. He usually covers all of the architect roles currently existing in the IT industry such as: software, solution, infrastructure, etc.

There are a lot of companies that do not have a person labeled “the architect”, however, his or her role and responsibilities are sometimes shared across senior developers or technical leaders. Is this a model that all companies should follow? Or looking from another perspective, where is the boundary between having an architect and not having an architect at all? What are the most suitable projects for such a dedicated position?

Traditional Agile methodologies, like SCRUM, do not explicitly define the role of an architect. A newer framework, called SAFe, has an entire chapter called “SAFe for Architects”, which in my opinion, does not bring anything new in comparison to the classical architectural theory, already covered by the books. Does this mean if we use one Agile methodology (e.g. SAFe) we should implicitly hire an architect and if we follow another Agile methodology (e.g. SCRUM) we might have this role optional? Looking from the methodology perspective it might be a trap. We should not let the framework to dictate us if it is legitimate or not to have an architect, but rather to identify the real project needs and based on them to make a decision. This is why, in the next paragraph, I will detail what might such potential projects be, which based on my experience, need an architect.

## **Type of projects that might need an architect**

There are projects where the need for a dedicated architect becomes more stringent. These projects might fit into one of the below categories:

- greenfield projects, where there is a lot of architectural work, especially in the beginning, to define the proper architectural styles, suitable patterns, development guidelines and principles, technology stack, implementing Proofs-Of-Concept to verify the feasibility of some ideas, etc.
- projects under intensive development, where the architecture is continuously evolving, the new business requirements are assessed in regards to their impact on the current architecture and new architectural decisions need to be made.
- projects which heavily interact with external systems, where the architect is intensively involved in the communication with the external stakeholders, focusing on the integration parts, covering both the technological side (e.g. communication protocols, message types, interaction flows, etc.) but also the business side. This activity could be quite exhausting if there are a lot of such integration points.
- projects with complex, distributed architectures, where the architect must be in charge of all developed parts, their boundaries and how they interact with each other. For example, a microservices architecture with tens or even hundreds of developed microservices. The architect must have the overall picture, ensuring consistency and integrity across different services, but also to offer vision and guidance for the teams.

## **Type of projects that might not necessarily need an architect**

There are also situations where the architect role might not be fundamentally necessary, for example:

- projects under maintenance or projects where no major developments with architectural impact are foreseen. In such a case, the only development requests might be for small enhancements or extensions and most of the effort is spent on fixing bugs and developing patches.
- projects where the business problems are already rationalized and an architectural reference, styles, and patterns exist. If all the new development requests follow the same recurring patterns and there are no real new technical challenges, the technology stack is the same, the role of the architect might be unnecessary.
- projects where the technical decisions are owned by external architecture governance. An example might be in the case of some outsourcing projects, where the level and the number of technical decisions made by the outsourcing team are rather limited. All the sensitive or risky architectural approaches must be validated with the stakeholders on the client-side, who also owns the architecture.
- extension projects which are more focused on building derivatives of the existing product or custom integrations, as per specific environments. A good example might be the teams which offer consultancy for products which are usually developed by other teams or different companies. Nevertheless, these extension teams might have an architect in place, able to communicate with the client and find the best solutions to his problems, however, this role is sometimes optional.
- utility projects, in general, developed and used internally, within an organization unit. This might have a small scope, limited dependencies on other systems but also fewer architectural challenges. For example, some automation scripts or tiny applications (or add-ons) used to generate different statistics for the employees, an internal booking or planning system used by one of few departments, etc.
- projects, where there are no new integrations and the team, has less or minimal dependencies on other systems.

These two categories are nor black or white neither binary values. This does not mean that if your project is more similar to one category or the other there should be a YES or NO decision, but rather carefully identify the need for an architect based on the project complexity, technical challenges, external dependencies, etc. Understanding the project context, the scope or its mission will help us in making a rational decision about hiring an architect or not in the team.

---

**Tags**: Software Architecture, Architect Role, Software Development, Project Management, Architectural Decisions, Software Engineering, Career, IT Industry, Project Types

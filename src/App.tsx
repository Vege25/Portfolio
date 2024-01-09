import AboutMe from './components/aboutMe.tsx';
import ContactComponent from './components/contactComponent.tsx';
import FooterComponent from './components/footerComponent.tsx';
import Introduction from './components/introduction.tsx';
import Navigation from './components/navigation.tsx';
import Projects from './components/projects.tsx';
import './index.css';

function App() {
  return (
    <>
      <div className='md:mx-4 lg:mx-8 xl:mx-16'>
        <Navigation />
        <section id='contentMargin' className='md:mx-4 lg:mx-8 xl:mx-44'>
          <Introduction />
        </section>
        <AboutMe />
        <Projects />
        <ContactComponent />
      </div>

      <FooterComponent />
    </>
  );
}

export default App;
